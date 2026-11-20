import { asc, eq } from 'drizzle-orm';
import { normalizePartName, normalizePartNumber, partNumberBase, type ListingKind, type PartSide } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { categories, listingFitments, listingMachines, partRequestFitments, partRequestReplies, users } from '../../db/schema.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../lib/errors.js';
import type { ListingRow } from '../listings/locks.js';
import { getSettings } from '../settings.service.js';
import { isEligibleSeller } from './eligibility.js';
import { lockPartRequest, partRequestNotFound, type PartRequestRow } from './locks.js';
import { checkReplyCaps, ownPartRequest } from './reply-options.js';
import { maskedRequestName } from './reply-views.js';

// "List a matching part" from a request (spec §9.3, review Q4, plan D4, D11; plan A2-4): `POST /listings { kind,
// partRequestId }` creates a draft prefilled from the request and a `pending` reply that is delivered when the listing
// goes live (`reply-delivery.ts`). `createListing` already holds the seller business `FOR NO KEY UPDATE`; this file
// takes the request `FOR SHARE` after it (§9.5). Every failure throws, so the draft and the reply roll back together.

/** What `createListing` spreads over its defaults. `side` only for Left / Right / Pair (never overrides with null). */
export interface PendingReplyPrep {
  request: PartRequestRow;
  listingValues: {
    kind: ListingKind;
    title: string;
    titleNorm: string;
    partNumber: string | null;
    partNumberNorm: string | null;
    partNumberBase: string | null;
    side?: PartSide;
    categoryId: string | null;
  };
}

/**
 * Checks 1–2 of §9.3 in order, under the request's `FOR SHARE` lock: (1) the request is visible to the seller and it is
 * eligible (`404 PART_REQUEST_NOT_FOUND`; its own business → `409 OWN_PART_REQUEST`), the request is `active` (`409
 * PART_REQUEST_NOT_ACTIVE`), the draft's kind is the request's (`400 REPLY_LISTING_INVALID { reasons: { draft:
 * 'kind' } }`, D11); (2) the reply caps (`409 REPLY_LIMIT`, `429 REPLY_DAILY_LIMIT`). Returns the prefill (identity
 * only, review Q4: title = the masked name, part number with its norms, side when Left / Right / Pair, the category
 * for a part group or a machine request's machine type, null on a part request's machine type), or null without a
 * `partRequestId`.
 */
export async function preparePendingReply(
  tx: Tx,
  seller: { userId: string; businessId: string },
  partRequestId: string | undefined,
  kind: ListingKind,
): Promise<PendingReplyPrep | null> {
  if (!partRequestId) return null;
  // A pending reply is a business write (R2): a viewer member reads only.
  const [member] = await tx.select({ memberRole: users.memberRole }).from(users).where(eq(users.id, seller.userId));
  if (member?.memberRole === 'viewer') throw new ForbiddenError('Viewers can read but not write', 'VIEWER_READ_ONLY');
  const request = await lockPartRequest(tx, partRequestId, 'share');
  if (!request) throw partRequestNotFound();
  if (request.businessId === seller.businessId) throw ownPartRequest();
  if (!(await isEligibleSeller(tx, request.id, seller.businessId))) throw partRequestNotFound();
  if (request.status !== 'active') {
    throw new ConflictError('This requirement is no longer open', 'PART_REQUEST_NOT_ACTIVE');
  }
  if (kind !== request.kind) {
    throw new ValidationError('This listing can’t answer the requirement', { reasons: { draft: 'kind' } }, 'REPLY_LISTING_INVALID');
  }
  await checkReplyCaps(tx, await getSettings(tx), request.id, seller.businessId, 1);

  const [node] = await tx.select({ level: categories.level }).from(categories).where(eq(categories.id, request.categoryId));
  const categoryId = request.kind === 'machine' || node?.level === 'part_group' ? request.categoryId : null;
  const title = maskedRequestName(request.name);
  const side = request.side && request.side !== 'not_applicable' ? request.side : undefined;
  const norm = request.partNumber ? normalizePartNumber(request.partNumber) : null;
  return {
    request,
    listingValues: {
      kind: request.kind,
      title,
      titleNorm: normalizePartName(title),
      partNumber: request.partNumber,
      partNumberNorm: norm || null,
      partNumberBase: norm ? partNumberBase(norm, side ?? null) : null,
      ...(side ? { side } : {}),
      categoryId,
    },
  };
}

/**
 * After the draft insert (and before `refreshListingSearch`, so the search text sees it): a part request's fits as the
 * draft's fitments, a machine request's **first** fit as its `listing_machines` brand + model (year left empty), then
 * the `pending` reply. No-op for null.
 */
export async function applyDraftPrefill(tx: Tx, prep: PendingReplyPrep | null, listing: ListingRow): Promise<void> {
  if (!prep) return;
  const fits = await tx
    .select()
    .from(partRequestFitments)
    .where(eq(partRequestFitments.partRequestId, prep.request.id))
    .orderBy(asc(partRequestFitments.sortOrder), asc(partRequestFitments.id));
  if (listing.kind === 'part' && fits.length > 0) {
    await tx.insert(listingFitments).values(
      fits.map((f, i) => ({
        listingId: listing.id,
        brandId: f.brandId,
        modelId: f.modelId,
        yearFrom: f.yearFrom,
        yearTo: f.yearTo,
        source: 'seller' as const,
        sortOrder: i,
      })),
    );
  }
  if (listing.kind === 'machine' && fits[0]) {
    await tx
      .update(listingMachines)
      .set({ brandId: fits[0].brandId, modelId: fits[0].modelId })
      .where(eq(listingMachines.listingId, listing.id));
  }
  await tx.insert(partRequestReplies).values({
    partRequestId: prep.request.id,
    sellerBusinessId: listing.businessId,
    listingId: listing.id,
    createdByUserId: listing.createdByUserId,
    status: 'pending',
  });
}
