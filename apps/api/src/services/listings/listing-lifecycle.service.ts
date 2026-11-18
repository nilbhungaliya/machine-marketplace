import { and, eq, sql } from 'drizzle-orm';
import {
  listingTransition,
  type ListingAction,
  type ListingActor,
  type ListingStatus,
  type ReviewReason,
} from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { listingStatusHistory, listings } from '../../db/schema.js';
import { ConflictError } from '../../lib/errors.js';
import { lockBusinessThenListing, lockListingOnly, type ListingRow } from './locks.js';

// The listing state machine (F2 spec §7.2). **This file is the only writer of `listings.status`**: every change goes
// through `writeStatus`, a conditional `UPDATE … WHERE id = $1 AND status = $from` plus one `listing_status_history`
// row. Transitions come from `LISTING_TRANSITIONS` in shared-types, always looked up with the actor. Task 8 adds the
// go-live gate and publish, Task 9 the seller and admin transitions.

/** `409 LISTING_TRANSITION_NOT_ALLOWED` with `details: { from, action }` (§7.2). */
export function transitionNotAllowed(from: ListingStatus, action: ListingAction | 'delete'): ConflictError {
  return new ConflictError("This listing can't do that in its current state", 'LISTING_TRANSITION_NOT_ALLOWED', { from, action });
}

/** Columns a transition may set besides the ones `writeStatus` owns. Never `status`. */
type TransitionColumns = Partial<
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
