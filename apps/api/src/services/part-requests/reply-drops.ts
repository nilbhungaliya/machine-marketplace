import { and, asc, eq, sql } from 'drizzle-orm';
import type { PartRequestDropReason } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { partRequestReplies, partRequests } from '../../db/schema.js';
import { notify } from '../notifications/notify.js';
import type { PartRequestRow, ReplyRow } from './locks.js';
import { maskedRequestName } from './reply-views.js';

// Pending replies that will never be delivered (spec §9.3, R7): `pending → dropped`, final, with a reason the seller
// sees. Conditional on `status = 'pending'`, so a reply delivered meanwhile is untouched.

/**
 * Drops one pending reply; a no-op when it is no longer pending. With `notifySeller`, `part_request_reply_dropped` goes
 * to the seller business (dedupe `part_request_reply_dropped:<replyId>`, params `{ requestTitle (masked), reason }`).
 * `requestName` saves a read when the caller has the request row. Returns whether the reply was dropped.
 */
export async function dropReply(
  tx: Tx,
  reply: ReplyRow,
  reason: PartRequestDropReason,
  opts: { notifySeller: boolean; requestName?: string },
): Promise<boolean> {
  const [dropped] = await tx
    .update(partRequestReplies)
    .set({ status: 'dropped', dropReason: reason, droppedAt: sql`now()` as unknown as Date })
    .where(and(eq(partRequestReplies.id, reply.id), eq(partRequestReplies.status, 'pending')))
    .returning({ id: partRequestReplies.id });
  if (!dropped) return false;
  if (opts.notifySeller) {
    let name = opts.requestName;
    if (name === undefined) {
      const [r] = await tx.select({ name: partRequests.name }).from(partRequests).where(eq(partRequests.id, reply.partRequestId));
      name = r?.name ?? '';
    }
    await notify(tx, {
      type: 'part_request_reply_dropped',
      recipientBusinessId: reply.sellerBusinessId,
      params: { requestTitle: maskedRequestName(name), reason },
      destination: { partRequestId: reply.partRequestId },
      dedupeKey: `part_request_reply_dropped:${reply.id}`,
    });
  }
  return true;
}

/** Every pending reply on a request that left `active` is dropped, each seller told. Returns how many were dropped. */
export async function dropPendingRepliesForRequest(
  tx: Tx,
  request: PartRequestRow,
  reason: 'request_closed' | 'request_expired' | 'request_removed',
): Promise<number> {
  const pending = await tx
    .select()
    .from(partRequestReplies)
    .where(and(eq(partRequestReplies.partRequestId, request.id), eq(partRequestReplies.status, 'pending')))
    .orderBy(asc(partRequestReplies.id));
  let n = 0;
  for (const reply of pending) {
    if (await dropReply(tx, reply, reason, { notifySeller: true, requestName: request.name })) n++;
  }
  return n;
}
