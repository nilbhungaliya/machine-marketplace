import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { hasEffects, queueUserEmit } from '../../lib/tx-effects.js';
import { businessMembers } from '../chat/members.js';
import { notificationUnreadOf, queueDeliveries } from './notify.js';

/**
 * Grouped F8 rows (spec §10.2; like `chat-rows.ts`, textile `services/alerts/alert-rows.ts`): one unread
 * `part_request_reply` row and one unread `part_match` row per user and request, on the partial unique index
 * `notifications_open_request_row` (`user_id`, `part_request_id`, `type`) WHERE grouped type AND `read_at IS NULL`.
 *
 * Callers call this only for an event that happened once (a match row just inserted with `RETURNING`, a reply whose
 * conditional `pending → delivered` or insert just succeeded): the open row stores only its opening event's key, so a
 * later event's repeat is prevented there, upstream. The opening event's key repeated after the row was read is a no-op
 * (the `(user_id, dedupe_key)` unique, checked in the insert's `WHERE NOT EXISTS`; the caller's request lock keeps two
 * transactions from opening the same key at once).
 *
 * A new row starts at `unread_count` 1, version 1; an open one gets `unread_count + 1`, the new params, `updated_at`
 * (moves to the top) and, only when `push`, `version + 1` with a `queued` delivery per device of a push-enabled member
 * (over the daily push cap the row is bumped silently, D6). `notification:new { unreadCount }` is queued either way.
 */
export async function upsertRequestNotification(
  tx: Tx,
  input: {
    type: 'part_match' | 'part_request_reply';
    partRequestId: string;
    recipientBusinessId: string;
    params: Record<string, string | number | null>;
    eventKey: string;
    push: boolean;
  },
): Promise<void> {
  const members = await businessMembers(tx, input.recipientBusinessId);
  if (members.length === 0) return;
  const params = JSON.stringify(input.params);
  const bump = input.push ? 1 : 0;
  const changed: Array<{ id: string; userId: string; version: number }> = [];
  for (const m of members) {
    const { rows } = await tx.execute(sql`
      INSERT INTO notifications
        (user_id, business_id, type, category, params, part_request_id, dedupe_key, unread_count, version)
      SELECT ${m.userId}::uuid, ${input.recipientBusinessId}::uuid, ${input.type}, 'requests', ${params}::jsonb,
             ${input.partRequestId}::uuid, ${input.eventKey}, 1, 1
      WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = ${m.userId} AND dedupe_key = ${input.eventKey})
      ON CONFLICT (user_id, part_request_id, type) WHERE type IN ('part_match', 'part_request_reply') AND read_at IS NULL
      DO UPDATE SET unread_count = notifications.unread_count + 1,
                    params = excluded.params,
                    version = notifications.version + ${bump}::int,
                    updated_at = now()
      RETURNING id, user_id, version`);
    for (const r of rows as Array<{ id: string; user_id: string; version: number }>) {
      changed.push({ id: r.id, userId: r.user_id, version: Number(r.version) });
    }
  }
  if (changed.length === 0) return;
  if (input.push) await queueDeliveries(tx, changed);
  for (const userId of new Set(changed.map((c) => c.userId))) {
    queueUserEmit(tx, userId, 'notification:new', { unreadCount: await notificationUnreadOf(tx, userId) });
  }
}

/**
 * The buyer opened the request (`POST /part-requests/:id/read`, spec §10.2): both of that user's grouped rows on it are
 * marked read; their queued deliveries are then skipped by the push job. Queues the new unread count when run in
 * `runTx`.
 */
export async function markRequestNotificationsRead(tx: Tx, userId: string, partRequestId: string): Promise<void> {
  const { rows } = await tx.execute(sql`
    UPDATE notifications SET read_at = now()
     WHERE user_id = ${userId} AND part_request_id = ${partRequestId}
       AND type IN ('part_match', 'part_request_reply') AND read_at IS NULL
    RETURNING id`);
  if (rows.length > 0 && hasEffects(tx)) {
    queueUserEmit(tx, userId, 'notification:new', { unreadCount: await notificationUnreadOf(tx, userId) });
  }
}
