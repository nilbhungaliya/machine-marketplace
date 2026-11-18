import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import {
  OPEN_LISTING_STATUSES,
  sanityFlags,
  type ListingFlag,
  type ListingProblem,
  type ReviewReason,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listingMedia, listingRentals, listings, units } from '../../db/schema.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../lib/errors.js';
import { getSettings } from '../settings.service.js';
import { attentionProblems, loadListing } from './listing-view.service.js';
import type { BusinessRow, ListingRow } from './locks.js';

// Completeness and the go-live gate (F2 spec §5.5, plan Task 8). The gate decides every move into `live`: publish (from
// `draft` or, as a resubmission, from `rejected`), resume, renew, relist and end of rental. It answers `live`, or
// `pending_review` with the review reasons, or refuses. Status itself is written only by `listing-lifecycle.service.ts`.

type Conn = Db | Tx;

/**
 * The dev switch (R31): `LISTING_MEDIA_OPTIONAL=true` lets a listing go public without a photo before R2 is set up. Read
 * per call and ignored in production.
 */
export function mediaOptional(): boolean {
  return process.env.LISTING_MEDIA_OPTIONAL === 'true' && process.env.NODE_ENV !== 'production';
}

/** `400 LISTING_INCOMPLETE` with `details.problems` (§5.5 step 3, amendment 2). */
export function listingIncomplete(problems: ListingProblem[]): ValidationError {
  return new ValidationError('This listing is missing something it needs', { problems }, 'LISTING_INCOMPLETE');
}

/**
 * The photo rule alone (amendment 2): `[{ field: 'photos', code: 'required' }]` while the listing has no photo, unless
 * the dev switch is on. Approve and unhide refuse with it, so no listing goes on view without a photo.
 */
export async function photoProblems(conn: Conn, listingId: string): Promise<ListingProblem[]> {
  if (mediaOptional()) return [];
  const [photo] = await conn
    .select({ id: listingMedia.id })
    .from(listingMedia)
    .where(and(eq(listingMedia.listingId, listingId), eq(listingMedia.type, 'photo')))
    .limit(1);
  return photo ? [] : [{ field: 'photos', code: 'required' }];
}

/**
 * What stands between the listing and publishing (§5.5 step 3), all at once: a category (on a draft, still an active
 * node of the right level: `CATEGORY_INVALID`), title, quantity, unit (parts), condition (not rentals), delivery, the
 * machine make (R18), a location; then the same rules as the owner view's nudges (`attentionProblems`, so the field
 * names match): side, required specs, a photo (skipped with the dev switch, R31), price model / price / GST mode, or a
 * rental rate.
 */
export async function checkPublishable(conn: Conn, listing: ListingRow): Promise<ListingProblem[]> {
  const loaded = await loadListing(conn, listing);
  const { row, node } = loaded;
  const problems: ListingProblem[] = [];

  if (!row.categoryId) problems.push({ field: 'categoryId', code: 'required' });
  else if (row.status === 'draft' && (!node || !node.chainActive || node.level !== (row.kind === 'part' ? 'part_group' : 'machine_type'))) {
    problems.push({ field: 'categoryId', code: 'CATEGORY_INVALID' });
  }
  if (!row.title?.trim()) problems.push({ field: 'title', code: 'required' });
  if (row.quantity === null) problems.push({ field: 'quantity', code: 'required' });
  if (row.kind === 'part' && !row.unitId) problems.push({ field: 'unitId', code: 'required' });
  if (row.kind !== 'machine_rental' && !row.conditionId) problems.push({ field: 'conditionId', code: 'required' });
  if (row.delivery.length === 0) problems.push({ field: 'delivery', code: 'required' });
  if (row.kind !== 'part' && !loaded.detail.machine?.brandId && !loaded.detail.machine?.brandOther) {
    problems.push({ field: 'machine.brandId', code: 'required' });
  }
  if (!row.pincode || !row.city) problems.push({ field: 'location', code: 'required' });

  const nudges = attentionProblems(loaded).filter((p) => !(p.field === 'photos' && mediaOptional()));
  problems.push(...nudges);
  return problems;
}

/** The sanity flags of the listing as stored now (§5.4), from its row, unit and rental rates. */
export async function currentFlags(conn: Conn, listing: ListingRow): Promise<ListingFlag[]> {
  const [unit] = listing.unitId
    ? await conn.select({ isMachineUnit: units.isMachineUnit }).from(units).where(eq(units.id, listing.unitId))
    : [];
  const [rental] =
    listing.kind === 'machine_rental'
      ? await conn.select().from(listingRentals).where(eq(listingRentals.listingId, listing.id))
      : [];
  return sanityFlags({
    kind: listing.kind,
    priceModel: listing.priceModel,
    pricePaise: listing.pricePaise,
    quantity: listing.quantity,
    unitIsMachineUnit: unit?.isMachineUnit ?? false,
    rental: rental ?? null,
  });
}

/** What the gate is asked for: `publish` from a draft, `resubmit` = publish from `rejected`. */
export type GateAction = 'publish' | 'resubmit' | 'relist' | 'resume' | 'renew' | 'end_rental';

export interface GateResult {
  to: 'live' | 'pending_review';
  reasons: ReviewReason[];
  /** The flags to store: today's sanity flags plus any stored ones (a flag stored while the listing was off view). */
  flags: ListingFlag[];
}

/** Go-live actions of a listing that was already approved: a reason remembered while off view sends them to review. */
const BACK_ON_VIEW: readonly GateAction[] = ['resume', 'renew', 'relist', 'end_rental'];

/**
 * The go-live gate, exactly the §5.5 table (run under the business → listing locks):
 *
 * | Check | publish | resubmit | relist | resume, renew, end_rental |
 * |---|---|---|---|---|
 * | rental from a business without GST → `403 RENTAL_NEEDS_GST` | ✓ | ✓ | ✓ | ✓ |
 * | unverified business at the open-listing cap (other open listings) → `409 UNVERIFIED_LISTING_CAP` | ✓ | — | ✓ | — |
 * | unverified business → `unverified_seller` | ✓ | ✓ | ✓ | — |
 * | `resubmitted` | — | ✓ | — | — |
 * | verified business with < `listing_review_first_n` listings that ever went live → `first_listings` | ✓ | — | — | — |
 * | a flag no moderator accepted → that flag | ✓ | ✓ | ✓ | ✓ |
 * | `edited_after_report` remembered on the listing (amendment 5) | — | — | ✓ | ✓ |
 */
export async function goLiveGate(tx: Tx, business: BusinessRow, listing: ListingRow, action: GateAction): Promise<GateResult> {
  const verified = business.verificationLevels.includes('gst');
  if (listing.kind === 'machine_rental' && !verified) {
    throw new ForbiddenError('Verify your GST to list machines for rent', 'RENTAL_NEEDS_GST');
  }
  const settings = await getSettings(tx);
  const reasons: ReviewReason[] = [];

  if (!verified && (action === 'publish' || action === 'relist')) {
    // I7: the business's open listings other than this one (a relisted unavailable listing is already counted).
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(eq(listings.businessId, business.id), ne(listings.id, listing.id), inArray(listings.status, [...OPEN_LISTING_STATUSES])));
    const cap = settings.unverified_listing_cap;
    if (open!.n >= cap) {
      throw new ConflictError(`Verify your GST to list more than ${cap} listings`, 'UNVERIFIED_LISTING_CAP', { cap });
    }
  }
  if (!verified && (action === 'publish' || action === 'resubmit' || action === 'relist')) reasons.push('unverified_seller');
  if (action === 'resubmit') reasons.push('resubmitted');
  if (verified && action === 'publish') {
    const [wentLive] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(eq(listings.businessId, business.id), isNotNull(listings.firstLiveAt)));
    if (wentLive!.n < settings.listing_review_first_n) reasons.push('first_listings');
  }

  const flags = [...new Set([...(await currentFlags(tx, listing)), ...listing.flags])];
  for (const flag of flags) if (!listing.acceptedFlags.includes(flag)) reasons.push(flag);
  if (BACK_ON_VIEW.includes(action) && listing.reviewReasons.includes('edited_after_report')) reasons.push('edited_after_report');

  return { to: reasons.length > 0 ? 'pending_review' : 'live', reasons, flags };
}
