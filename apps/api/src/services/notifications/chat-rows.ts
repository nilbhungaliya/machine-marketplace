import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { hasEffects, queueUserEmit } from '../../lib/tx-effects.js';
import { businessMembers, type ThreadRow } from '../chat/members.js';
import { notificationUnreadOf, queueDeliveries } from './notify.js';

/**
 * Grouped chat notifications (F6 + F7 spec §11.2; ported from textile `services/notifications/chat-rows.ts`): one
 * unread `message_new` row per user and thread, bumped by each new message (`unread_count`, `last_seq`, `version`).
 * Written with `INSERT … ON CONFLICT` on the partial unique index `notifications_open_chat_row`, so two messages at once
 * can't make two rows. Reading the thread marks the row read; the next message starts a new row. L4-3 owns this file.
 */

/**
 * The message `seq` lands on each active member of the recipient business (the other party: never the sender's own
 * business, P14). A new row starts at 1 / version 1; an open one gets `unread_count + 1`, `version + 1`, the newer seq
 * and moves to the top (`updated_at`). A seq at or below the row's `last_seq` (a repeat) changes nothing. Each new
 * version gets a `queued` delivery per device of a push-enabled user (`deliveryKey = <id>:<version>`), and
 * `notification:new { unreadCount }` is queued to the user.
 */
export async function upsertChatNotification(
  tx: Tx,
  input: { thread: ThreadRow; recipientBusinessId: string; senderBusinessName: string; seq: number },
): Promise<void> {
  const members = await businessMembers(tx, input.recipientBusinessId);
  if (members.length === 0) return;
  const params = JSON.stringify({ businessName: input.senderBusinessName });
  const changed: Array<{ id: string; userId: string; version: number }> = [];
  for (const m of members) {
    const { rows } = await tx.execute(sql`
      INSERT INTO notifications
        (user_id, business_id, type, category, params, thread_id, dedupe_key, unread_count, last_seq, version)
      VALUES
        (${m.userId}, ${input.recipientBusinessId}, 'message_new', 'chat', ${params}::jsonb, ${input.thread.id},
         ${`message_new:${input.thread.id}:${input.seq}`}, 1, ${input.seq}, 1)
      ON CONFLICT (user_id, thread_id) WHERE type = 'message_new' AND read_at IS NULL
      DO UPDATE SET unread_count = notifications.unread_count + 1,
                    last_seq = excluded.last_seq,
                    params = excluded.params,
                    version = notifications.version + 1,
                    updated_at = now()
              WHERE notifications.last_seq IS NULL OR notifications.last_seq < excluded.last_seq
      RETURNING id, user_id, version`);
    for (const r of rows as Array<{ id: string; user_id: string; version: number }>) {
      changed.push({ id: r.id, userId: r.user_id, version: Number(r.version) });
    }
  }
  if (changed.length === 0) return;
  await queueDeliveries(tx, changed);
  for (const c of changed) queueUserEmit(tx, c.userId, 'notification:new', { unreadCount: await notificationUnreadOf(tx, c.userId) });
}

/**
 * Reading a thread (`POST /threads/:id/read`) marks that user's grouped row read, in the read's transaction; its queued
 * deliveries are then skipped by the push job (the row is read). Queues the new unread count when the caller runs in
 * `runTx`.
 */
export async function markChatNotificationRead(tx: Tx, userId: string, threadId: string): Promise<void> {
  const { rows } = await tx.execute(sql`
    UPDATE notifications SET read_at = now()
     WHERE user_id = ${userId} AND thread_id = ${threadId} AND type = 'message_new' AND read_at IS NULL
    RETURNING id`);
  if (rows.length > 0 && hasEffects(tx)) {
    queueUserEmit(tx, userId, 'notification:new', { unreadCount: await notificationUnreadOf(tx, userId) });
  }
}
