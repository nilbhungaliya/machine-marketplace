import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  listingTransition,
  type AdminListingAction,
  type ListingAction,
  type ListingActor,
  type ListingOwnerView,
  type ListingStatus,
  type ReviewReason,
  type SellerListingAction,
} from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { listingStatusHistory, listings, reports, users } from '../../db/schema.js';
import { adminText } from '../../lib/admin-text.js';
import { ConflictError, ForbiddenError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { onboardingForUser } from '../business/profile.service.js';
import { getSettings } from '../settings.service.js';
import { checkPublishable, goLiveGate, listingIncomplete, photoProblems, type GateAction } from './listing-gate.service.js';
import { toOwnerView } from './listing-view.service.js';
import { listingNotFound, lockBusinessThenListing, lockListingOnly, type BusinessRow, type ListingRow } from './locks.js';

// The listing state machine (F2 spec §7.2). **This file is the only writer of `listings.status`**: every change goes
// through `writeStatus`, a conditional `UPDATE … WHERE id = $1 AND status = $from` plus one `listing_status_history`
// row. Transitions come from `LISTING_TRANSITIONS` in shared-types, always looked up with the actor: publish and the
// go-live gate (Task 8), seller actions and admin transitions (Task 9), system transitions (Task 6).

/** `409 LISTING_TRANSITION_NOT_ALLOWED` with `details: { from, action }` (§7.2). */
export function transitionNotAllowed(from: ListingStatus, action: ListingAction | 'delete'): ConflictError {
  return new ConflictError("This listing can't do that in its current state", 'LISTING_TRANSITION_NOT_ALLOWED', { from, action });
}

type Settable<T> = { [K in keyof T]?: T[K] | SQL };

/** Columns a transition may set besides the ones `writeStatus` owns. Never `status`. */
type TransitionColumns = Settable<
  Pick<
    typeof listings.$inferInsert,
    | 'moderationOutcome'
    | 'moderationNote'
    | 'moderatedAt'
    | 'moderatedBy'
    | 'statusReason'
    | 'refreshedAt'
    | 'publishedAt'
    | 'firstLiveAt'
    | 'flags'
    | 'acceptedFlags'
  >
>;

interface WriteStatusOptions {
  action: ListingAction;
  actor: ListingActor;
  userId?: string | null;
  adminId?: string | null;
  /** The history row's reason (seller note, moderator reason, system note). */
  reason?: string | null;
  /** `undefined` leaves `return_status` as it is; `null` clears it. */
  returnStatus?: ListingStatus | null;
  /** `undefined` leaves `review_reasons` as they are. */
  reviewReasons?: ReviewReason[];
  set?: TransitionColumns;
}

/**
 * The only status write. `listing` is what the caller read (under its locks): the UPDATE runs only while the row is
 * still in `listing.status`; 0 rows → `409 LISTING_TRANSITION_NOT_ALLOWED` and nothing is written. Sets
 * `status_changed_at`, `updated_at`, `return_status` / `review_reasons` as told, and writes one history row.
 */
async function writeStatus(tx: Tx, listing: ListingRow, to: ListingStatus, o: WriteStatusOptions): Promise<ListingRow> {
  const [row] = await tx
    .update(listings)
    .set({
      ...o.set,
      status: to,
      statusChangedAt: sql`now()`,
      updatedAt: sql`now()`,
      ...(o.returnStatus !== undefined ? { returnStatus: o.returnStatus } : {}),
      ...(o.reviewReasons !== undefined ? { reviewReasons: o.reviewReasons } : {}),
    })
    .where(and(eq(listings.id, listing.id), eq(listings.status, listing.status)))
    .returning();
  if (!row) throw transitionNotAllowed(listing.status, o.action);
  await tx.insert(listingStatusHistory).values({
    listingId: listing.id,
    fromStatus: listing.status,
    toStatus: to,
    action: o.action,
    actor: o.actor,
    userId: o.userId ?? null,
    adminId: o.adminId ?? null,
    reason: o.reason ?? null,
  });
  return row;
}

/** The first history row of a new draft (`from_status` null, §13.2). Creating a draft isn't a status change. */
export async function recordCreated(tx: Tx, listingId: string, userId: string): Promise<void> {
  await tx.insert(listingStatusHistory).values({
    listingId,
    fromStatus: null,
    toStatus: 'draft',
    action: 'create',
    actor: 'seller',
    userId,
  });
}

export type SystemTransitionAction = 'back_to_review' | 'expire' | 'photos_removed';

export interface SystemTransitionOptions {
  /** History reason; for `photos_removed` also the moderation note (R52). */
  reason?: string | null;
  /** `back_to_review`: merged into the listing's review reasons. */
  reviewReasons?: ReviewReason[];
  /**
   * `true`: lock the business, then the listing (a no-op when the caller already holds both). `false`: lock only the
   * listing. Defaults to `true`, except for `expire`, which always locks only the listing (amendment 1: the expiry job
   * must never wait for a business lock) and refuses `true`.
   */
  lockBusiness?: boolean;
  /** `photos_removed`: the admin whose media delete removed the last photo (history and `moderated_by`). */
  adminId?: string | null;
}

/**
 * A system transition (§7.2): `back_to_review` (`live` / `rented` → `pending_review`, `return_status = from`, review
 * reasons merged), `expire` (`live` / `rented` → `expired`), `photos_removed` (→ `rejected`, outcome
 * `changes_requested`, the reason as the note, `return_status` cleared). The move runs from `listing.status` as given:
 * a listing whose status changed since it was read is refused with `409 LISTING_TRANSITION_NOT_ALLOWED`.
 */
export async function applySystemTransition(
  tx: Tx,
  listing: ListingRow,
  action: SystemTransitionAction,
  opts: SystemTransitionOptions = {},
): Promise<ListingRow> {
  const transition = listingTransition(listing.status, action, listing.kind, 'system');
  if (!transition) throw transitionNotAllowed(listing.status, action);
  if (action === 'expire' && opts.lockBusiness === true) {
    throw new Error('expire locks only the listing (amendment 1): lockBusiness must not be true');
  }
  // The row as it is now, under the locks. The move still runs from `listing.status` (the caller's view), so a stale
  // object is refused by the conditional write; anything merged comes from `current`.
  const current =
    (opts.lockBusiness ?? action !== 'expire')
      ? (await lockBusinessThenListing(tx, listing.businessId, listing.id)).listing
      : await lockListingOnly(tx, listing.id);
  const to = transition.to as ListingStatus;
  const base = { action, actor: 'system' as const, reason: opts.reason ?? null };

  switch (action) {
    case 'back_to_review':
      return writeStatus(tx, listing, to, {
        ...base,
        returnStatus: listing.status,
        reviewReasons: [...new Set([...current.reviewReasons, ...(opts.reviewReasons ?? [])])],
      });
    case 'expire':
      return writeStatus(tx, listing, to, base);
    case 'photos_removed':
      return writeStatus(tx, listing, to, {
        ...base,
        adminId: opts.adminId ?? null,
        returnStatus: null,
        set: {
          moderationOutcome: 'changes_requested',
          moderationNote: opts.reason ?? null,
          moderatedAt: new Date(),
          moderatedBy: opts.adminId ?? null,
        },
      });
  }
}

const now = () => sql`now()`;

function onboardingIncomplete(): ConflictError {
  return new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
}

/** Writes what the gate decided (§5.5): the status, its review reasons and the columns every go-live write sets. */
async function writeGateResult(
  tx: Tx,
  listing: ListingRow,
  business: BusinessRow,
  gateAction: GateAction,
  o: { action: ListingAction; userId: string; reason?: string | null; returnStatus: ListingStatus | null; set?: TransitionColumns },
): Promise<ListingRow> {
  const gate = await goLiveGate(tx, business, listing, gateAction);
  return writeStatus(tx, listing, gate.to, {
    action: o.action,
    actor: 'seller',
    userId: o.userId,
    reason: o.reason ?? null,
    reviewReasons: gate.reasons,
    returnStatus: gate.to === 'pending_review' ? o.returnStatus : null,
    set: {
      ...o.set,
      flags: gate.flags,
      refreshedAt: now(),
      ...(gate.to === 'live' && !listing.firstLiveAt ? { firstLiveAt: now() } : {}),
    },
  });
}

export interface LifecycleResult {
  listing: ListingOwnerView;
  /** Where the listing landed: for publish and the go-live actions `live` or `pending_review`. */
  outcome: ListingStatus;
}

/**
 * `POST /listings/:id/publish` (§5.5), in the caller's transaction: (1) lock the business, then the listing, which must
 * be the caller's (`404`) and a `draft` or `rejected` one (`409 LISTING_TRANSITION_NOT_ALLOWED`); (2) onboarding done
 * (`409 ONBOARDING_INCOMPLETE`); (3) complete (`400 LISTING_INCOMPLETE` with every problem); (4) the gate (a rejected
 * listing is a resubmission); (5) status, review reasons, flags, `published_at` (first time), `refreshed_at`,
 * `first_live_at` (when live and still null) and one history row (actor `seller`); (6) the owner view and the outcome.
 */
export async function publishListing(tx: Tx, user: UserTokenPayload, id: string): Promise<LifecycleResult> {
  if (!user.businessId) throw listingNotFound();
  const { business, listing } = await lockBusinessThenListing(tx, user.businessId, id);
  if (!listingTransition(listing.status, 'publish', listing.kind, 'seller')) throw transitionNotAllowed(listing.status, 'publish');

  const [u] = await tx.select({ name: users.name, businessId: users.businessId }).from(users).where(eq(users.id, user.userId));
  if (!u || (await onboardingForUser(tx, u)) !== 'done') throw onboardingIncomplete();

  const problems = await checkPublishable(tx, listing);
  if (problems.length > 0) throw listingIncomplete(problems);

  const row = await writeGateResult(tx, listing, business, listing.status === 'rejected' ? 'resubmit' : 'publish', {
    action: 'publish',
    userId: user.userId,
    returnStatus: null,
    set: { publishedAt: listing.publishedAt ?? now() },
  });
  return { listing: await toOwnerView(tx, row, await getSettings(tx)), outcome: row.status };
}

/** Seller actions that go through the gate (§7.2 `to: 'gate'`). */
const GATED_ACTIONS: Partial<Record<SellerListingAction, GateAction>> = {
  resume: 'resume',
  renew: 'renew',
  relist: 'relist',
  end_rental: 'end_rental',
};

/**
 * `POST /listings/:id/actions` (§7.2), under the business → listing locks. The action must be a seller row of
 * `LISTING_TRANSITIONS` for the listing's status and kind (`409 LISTING_TRANSITION_NOT_ALLOWED` with
 * `details: { from, action }`). Resume, renew, relist and end of rental run the gate and refresh the listing; a
 * `pending_review` answer stores `return_status = 'live'`. The note goes to the history row; `mark_unavailable` stores
 * it as the status reason, `remove` too (and keeps the stored reason without one); other actions clear it.
 */
export async function applySellerAction(
  tx: Tx,
  user: UserTokenPayload,
  id: string,
  action: SellerListingAction,
  note?: string | null,
): Promise<LifecycleResult> {
  if (!user.businessId) throw listingNotFound();
  const { business, listing } = await lockBusinessThenListing(tx, user.businessId, id);
  const transition = listingTransition(listing.status, action, listing.kind, 'seller');
  if (!transition) throw transitionNotAllowed(listing.status, action);

  let row: ListingRow;
  const gateAction = GATED_ACTIONS[action];
  if (transition.to === 'gate' && gateAction) {
    row = await writeGateResult(tx, listing, business, gateAction, {
      action,
      userId: user.userId,
      reason: note ?? null,
      returnStatus: 'live',
      set: { statusReason: null },
    });
  } else {
    const statusReason = action === 'remove' ? (note ?? listing.statusReason) : action === 'mark_unavailable' ? (note ?? null) : null;
    row = await writeStatus(tx, listing, transition.to as ListingStatus, {
      action,
      actor: 'seller',
      userId: user.userId,
      reason: note ?? null,
      set: { statusReason },
    });
  }
  return { listing: await toOwnerView(tx, row, await getSettings(tx)), outcome: row.status };
}

export interface AdminTransitionOptions {
  /** The moderator's reason (reject, hide, remove) or message (ask for changes); the history row's reason. */
  reason?: string | null;
  /** Approve, ask for changes and reject (R53): the version the moderator loaded; another → `409 LISTING_CHANGED`. */
  version?: number;
}

const REASON_REQUIRED: readonly AdminListingAction[] = ['ask_for_changes', 'reject', 'hide', 'remove'];

/** Closes the listing's open reports as `actioned` (hide and remove, R51). */
async function actionOpenReports(tx: Tx, listingId: string, adminId: string, note: string | null): Promise<void> {
  await tx
    .update(reports)
    .set({ status: 'actioned', resolvedBy: adminId, resolvedAt: now(), resolutionNote: note })
    .where(and(eq(reports.targetType, 'listing'), eq(reports.targetId, listingId), inArray(reports.status, ['open', 'reviewing'])));
}

/**
 * A moderator's status transition (§7.2, §11.3), used by the admin routes (Task 16; they write the audit row). Locks
 * the business, then the listing; the move runs from `listing.status` as the caller read it (a stale object → `409`).
 * With `version`, a listing edited since → `409 LISTING_CHANGED` and nothing written.
 * - Reject, hide and remove need a reason, ask for changes a message (3–500 characters, `400 VALIDATION_ERROR`).
 * - `approve`: → the stored `return_status`, else `live`; clears it and the review reasons; `accepted_flags = flags`;
 *   outcome `approved`; `refreshed_at`, `first_live_at` when null. Refused without a photo (amendment 2) and, for a
 *   rental, when the business no longer holds GST (`403 RENTAL_NEEDS_GST`).
 * - `ask_for_changes` / `reject`: → `rejected`, outcome `changes_requested` / `rejected` with the message as the note;
 *   `return_status` cleared (amendment 4).
 * - `hide`: → `hidden`, `return_status = from`, the reason as the status reason; open reports actioned (R51).
 * - `unhide`: → `return_status`, cleared; refreshed (R14). Refused as approve is.
 * - `remove`: → `removed`, the reason as the status reason; open reports actioned (R51).
 */
export async function applyAdminTransition(
  tx: Tx,
  adminId: string,
  listing: ListingRow,
  action: AdminListingAction,
  opts: AdminTransitionOptions = {},
): Promise<ListingRow> {
  const { business, listing: current } = await lockBusinessThenListing(tx, listing.businessId, listing.id);
  if (opts.version !== undefined && opts.version !== current.version) {
    throw new ConflictError('The seller changed this listing since you opened it', 'LISTING_CHANGED');
  }
  if (!listingTransition(listing.status, action, listing.kind, 'admin')) throw transitionNotAllowed(listing.status, action);

  // Reject, hide and remove take a reason, ask for changes a message (§11.3: 3–500 characters, `400 VALIDATION_ERROR`).
  const reason = REASON_REQUIRED.includes(action)
    ? adminText(opts.reason ?? '', action === 'ask_for_changes' ? 'message' : 'reason')
    : opts.reason?.trim() || null;
  const base = { action, actor: 'admin' as const, adminId, reason };
  const moderated = (outcome: 'approved' | 'changes_requested' | 'rejected', note: string | null): TransitionColumns => ({
    moderationOutcome: outcome,
    moderationNote: note,
    moderatedAt: now(),
    moderatedBy: adminId,
  });
  // What approve and unhide check before a listing goes back on view: a photo (amendment 2) and, for a rental, a
  // business that still holds GST (decision 7: only GST-verified businesses list rentals).
  const requireOnView = async () => {
    if (listing.kind === 'machine_rental' && !business.verificationLevels.includes('gst')) {
      throw new ForbiddenError('This business is no longer GST verified, so its rentals stay off view', 'RENTAL_NEEDS_GST');
    }
    const problems = await photoProblems(tx, listing.id);
    if (problems.length > 0) throw listingIncomplete(problems);
  };

  switch (action) {
    case 'approve':
      await requireOnView();
      return writeStatus(tx, listing, current.returnStatus ?? 'live', {
        ...base,
        returnStatus: null,
        reviewReasons: [],
        set: {
          ...moderated('approved', null),
          acceptedFlags: current.flags,
          refreshedAt: now(),
          ...(current.firstLiveAt ? {} : { firstLiveAt: now() }),
        },
      });
    case 'ask_for_changes':
      return writeStatus(tx, listing, 'rejected', { ...base, returnStatus: null, set: moderated('changes_requested', reason) });
    case 'reject':
      return writeStatus(tx, listing, 'rejected', { ...base, returnStatus: null, set: moderated('rejected', reason) });
    case 'hide': {
      const row = await writeStatus(tx, listing, 'hidden', { ...base, returnStatus: listing.status, set: { statusReason: reason } });
      await actionOpenReports(tx, listing.id, adminId, reason);
      return row;
    }
    case 'unhide': {
      if (!current.returnStatus) throw transitionNotAllowed(listing.status, action);
      await requireOnView();
      return writeStatus(tx, listing, current.returnStatus, { ...base, returnStatus: null, set: { refreshedAt: now(), statusReason: null } });
    }
    case 'remove': {
      const row = await writeStatus(tx, listing, 'removed', { ...base, returnStatus: null, set: { statusReason: reason } });
      await actionOpenReports(tx, listing.id, adminId, reason);
      return row;
    }
  }
}
