import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { PartRequestDropReason } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { businessBlocks, businesses, categories, listingStatusHistory, listings, partRequestReplies } from '../../db/schema.js';
import type { ListingRow } from '../listings/locks.js';
import { upsertRequestNotification } from '../notifications/request-rows.js';
import { insertNewMatches, notifyNewMatch } from './auto-match.js';
import { machineCategoryOf } from './categories.js';
import { isEligibleSeller } from './eligibility.js';
import { emitRequestUpdated } from './emit.js';
import { lockPartRequestsInOrder, type PartRequestRow, type ReplyRow } from './locks.js';
import { dropReply } from './reply-drops.js';
import { replyFitReason } from './reply-fit.js';
import { maskedRequestName } from './reply-views.js';

// The `listing_changed` work (spec §7.1, §9.3, review Q3, Q5, Q7; plan A2-4; ports textile
// `services/requirements/replies.consumer.ts`): read the listing as it is now; `live` → new auto matches and delivery of
// its pending replies; `removed` / `rejected` → drop them. Lock order (§9.5): requests in id order (`FOR NO KEY
// UPDATE`), one pass, then reply / match rows (their FKs take `KEY SHARE` on the listing).

/** Why a pending reply's request no longer takes it, from the request's status. */
function requestGoneReason(status: PartRequestRow['status']): PartRequestDropReason {
  if (status === 'expired') return 'request_expired';
  if (status === 'removed') return 'request_removed';
  return 'request_closed';
}

async function blockedEitherWay(tx: Tx, a: string, b: string): Promise<boolean> {
  const { rows } = await tx.execute(sql`
    SELECT 1 FROM ${businessBlocks}
    WHERE (blocker_business_id = ${a} AND blocked_business_id = ${b}) OR (blocker_business_id = ${b} AND blocked_business_id = ${a})
    LIMIT 1`);
  return rows.length > 0;
}

/**
 * Pending replies on the listing, by its status now: `live` → each re-checked against its **locked** request (status,
 * blocks, eligibility (§6: audience / GST, suspension, onboarding), the pure `replyFitReason`); all pass → a conditional
 * `pending → delivered`, the buyer's grouped `part_request_reply` row (pushed) and `part_request:updated`; else dropped
 * with the first failing reason, the seller told. `removed` → `listing_removed` (the seller's own act, silent) or
 * `listing_removed_by_team` (the latest removal by an admin, seller told, D14). `rejected` → `listing_rejected`, seller
 * told. Anything else → nothing. A reply whose request isn't in `locked` is left for the next run.
 */
export async function processListingReplies(tx: Tx, listing: ListingRow, locked: Map<string, PartRequestRow>): Promise<void> {
  const pending = await tx
    .select()
    .from(partRequestReplies)
    .where(and(eq(partRequestReplies.listingId, listing.id), eq(partRequestReplies.status, 'pending')))
    .orderBy(asc(partRequestReplies.partRequestId), asc(partRequestReplies.id));
  if (pending.length === 0) return;

  if (listing.status === 'removed') {
    const [last] = await tx
      .select({ actor: listingStatusHistory.actor })
      .from(listingStatusHistory)
      .where(and(eq(listingStatusHistory.listingId, listing.id), eq(listingStatusHistory.toStatus, 'removed')))
      .orderBy(desc(listingStatusHistory.createdAt), desc(listingStatusHistory.id))
      .limit(1);
    const byTeam = last?.actor === 'admin';
    for (const reply of pending) {
      const request = locked.get(reply.partRequestId);
      if (!request) continue;
      await dropReply(tx, reply, byTeam ? 'listing_removed_by_team' : 'listing_removed', {
        notifySeller: byTeam,
        requestName: request.name,
      });
    }
    return;
  }
  if (listing.status === 'rejected') {
    for (const reply of pending) {
      const request = locked.get(reply.partRequestId);
      if (!request) continue;
      await dropReply(tx, reply, 'listing_rejected', { notifySeller: true, requestName: request.name });
    }
    return;
  }
  if (listing.status !== 'live') return;

  const [cat] = listing.categoryId
    ? await tx.select({ path: categories.path }).from(categories).where(eq(categories.id, listing.categoryId))
    : [];
  for (const reply of pending) {
    const request = locked.get(reply.partRequestId);
    if (!request) continue;
    const reason = await deliveryProblem(tx, request, reply, listing, cat?.path ?? null);
    if (reason) {
      await dropReply(tx, reply, reason, { notifySeller: true, requestName: request.name });
      continue;
    }
    await deliverReply(tx, request, reply);
  }
}

/** The first reason a pending reply can't be delivered now (§9.3, review Q5), or null. */
async function deliveryProblem(
  tx: Tx,
  request: PartRequestRow,
  reply: ReplyRow,
  listing: ListingRow,
  categoryPath: string | null,
): Promise<PartRequestDropReason | null> {
  if (request.status !== 'active') return requestGoneReason(request.status);
  if (await blockedEitherWay(tx, request.businessId, reply.sellerBusinessId)) return 'blocked';
  if (!(await isEligibleSeller(tx, request.id, reply.sellerBusinessId))) return 'not_eligible';
  const root = await machineCategoryOf(tx, request.categoryId);
  const misfit = root
    ? replyFitReason(
        { kind: request.kind, side: request.side, conditionIds: request.conditionIds, rootPath: root.path },
        { kind: listing.kind, side: listing.side, conditionId: listing.conditionId, categoryPath },
      )
    : 'category';
  return misfit ? 'no_longer_fits' : null;
}

/** `pending → delivered` (conditional), then the buyer's grouped row (pushed) and the socket nudge. */
async function deliverReply(tx: Tx, request: PartRequestRow, reply: ReplyRow): Promise<void> {
  const [done] = await tx
    .update(partRequestReplies)
    .set({ status: 'delivered', deliveredAt: sql`now()` as unknown as Date })
    .where(and(eq(partRequestReplies.id, reply.id), eq(partRequestReplies.status, 'pending')))
    .returning({ id: partRequestReplies.id });
  if (!done) return;
  await notifyReplyDelivered(tx, request, reply.id, reply.sellerBusinessId);
}

/** The buyer's grouped `part_request_reply` row for one delivered reply (pushed) and `part_request:updated`. */
export async function notifyReplyDelivered(
  tx: Tx,
  request: PartRequestRow,
  replyId: string,
  sellerBusinessId: string,
): Promise<void> {
  const [seller] = await tx.select({ name: businesses.tradeName }).from(businesses).where(eq(businesses.id, sellerBusinessId));
  await upsertRequestNotification(tx, {
    type: 'part_request_reply',
    partRequestId: request.id,
    recipientBusinessId: request.businessId,
    eventKey: `part_request_reply:${request.id}:${replyId}`,
    push: true,
    params: { businessName: seller?.name ?? '', requestTitle: maskedRequestName(request.name) },
  });
  emitRequestUpdated(tx, request, 'reply');
}

/**
 * The work job's `listing_changed` handler (§7.1), in this order: read the listing unlocked; when `live`, insert its
 * new matches (no request locks; a pending reply on it already excludes its request, §7.4 rule 7); then **one**
 * `lockPartRequestsInOrder` pass over only the requests with a new match or a pending reply on the listing; then the
 * pending replies (`processListingReplies`) and a `notifyNewMatch` per new match under those locks.
 */
export async function processListingChanged(tx: Tx, listingId: string): Promise<void> {
  const [listing] = await tx.select().from(listings).where(eq(listings.id, listingId));
  if (!listing || (listing.kind !== 'part' && listing.kind !== 'machine')) return;
  if (listing.status !== 'live' && listing.status !== 'removed' && listing.status !== 'rejected') return;

  const matches = listing.status === 'live' ? await insertNewMatches(tx, listing) : [];
  const pendingOn = await tx
    .selectDistinct({ id: partRequestReplies.partRequestId })
    .from(partRequestReplies)
    .where(and(eq(partRequestReplies.listingId, listing.id), eq(partRequestReplies.status, 'pending')));
  const ids = [...new Set([...matches.map((m) => m.partRequestId), ...pendingOn.map((p) => p.id)])];
  if (ids.length === 0) return;

  const locked = new Map((await lockPartRequestsInOrder(tx, ids)).map((r) => [r.id, r]));
  await processListingReplies(tx, listing, locked);
  for (const match of matches) {
    const request = locked.get(match.partRequestId);
    if (request) await notifyNewMatch(tx, request, listing, match);
  }
}
