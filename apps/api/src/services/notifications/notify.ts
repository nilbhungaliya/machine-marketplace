import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { notificationCategory, type NotificationType } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { notificationDeliveries, notifications, userDevices, users } from '../../db/schema.js';
import { queueUserEmit } from '../../lib/tx-effects.js';
import { businessMembers } from '../chat/members.js';

/**
 * In-app notifications and their push deliveries (F6 + F7 spec §11; row creation ported from textile
 * `services/notifications/notification.service.ts` + `recipients.ts`). Inside the caller's transaction:
 * - one `notifications` row per **active** member of the recipient business (viewers included), `ON CONFLICT (user_id,
 *   dedupe_key) DO NOTHING`, so a repeated event is a no-op;
 * - one `notification_deliveries` row (`queued`, version 1) per device of each new row's user with `push_enabled`; the
 *   push job sends them after commit (L4-4);
 * - `notification:new { unreadCount }` queued to each recipient's `userRoom`.
 *
 * `dedupeKey`: `<type>:<entityId>[:<qualifier>]`. `params` hold ids and safe values only (business name, listing title,
 * price per unit, quantity, deal ref) — never message text, notes, numbers or emails (§11.4). Grouped chat rows
 * (`message_new`) go through `upsertChatNotification` (L4-3), not here.
 */

export interface NotifyInput {
  type: NotificationType;
  recipientBusinessId: string;
  params: Record<string, string | number | null>;
  destination: {
    threadId?: string;
    offerId?: string;
    dealId?: string;
    reviewId?: string;
    partRequestId?: string;
    /** M14 §11: the rental booking a `rental_booking_*` row (or a rental review row) opens. */
    rentalBookingId?: string;
  };
  dedupeKey: string;
  /** F8 (plan D6): false writes the rows without deliveries (in-app only, e.g. over the daily push cap). Default true. */
  push?: boolean;
}

/** Returns the ids of the rows it created (empty for a repeat). */
export async function notify(tx: Tx, input: NotifyInput): Promise<string[]> {
  const members = await businessMembers(tx, input.recipientBusinessId);
  if (members.length === 0) return [];
  const category = notificationCategory(input.type);
  const created = await tx
    .insert(notifications)
    .values(
      members.map((m) => ({
        userId: m.userId,
        businessId: input.recipientBusinessId,
        type: input.type,
        category,
        params: input.params,
        threadId: input.destination.threadId ?? null,
        offerId: input.destination.offerId ?? null,
        dealId: input.destination.dealId ?? null,
        reviewId: input.destination.reviewId ?? null,
        partRequestId: input.destination.partRequestId ?? null,
        rentalBookingId: input.destination.rentalBookingId ?? null,
        dedupeKey: input.dedupeKey,
      })),
    )
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
    .returning({ id: notifications.id, userId: notifications.userId, version: notifications.version });
  if (created.length === 0) return [];

  if (input.push !== false) await queueDeliveries(tx, created);
  for (const userId of new Set(created.map((r) => r.userId))) {
    queueUserEmit(tx, userId, 'notification:new', { unreadCount: await unreadCountOf(tx, userId) });
  }
  return created.map((r) => r.id);
}

/** One `queued` delivery per device of each row's user, when the user has push on. Shared with the grouped chat rows. */
export async function queueDeliveries(tx: Tx, rows: Array<{ id: string; userId: string; version: number }>): Promise<void> {
  if (rows.length === 0) return;
  const devices = await tx
    .select({ id: userDevices.id, userId: userDevices.userId })
    .from(userDevices)
    .innerJoin(users, eq(users.id, userDevices.userId))
    .where(and(inArray(userDevices.userId, [...new Set(rows.map((r) => r.userId))]), eq(users.pushEnabled, true)));
  const values = rows.flatMap((r) =>
    devices.filter((d) => d.userId === r.userId).map((d) => ({ notificationId: r.id, version: r.version, deviceId: d.id })),
  );
  if (values.length) await tx.insert(notificationDeliveries).values(values).onConflictDoNothing();
}

async function unreadCountOf(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** For callers that build their own rows (the grouped chat row): the same unread count the emit carries. */
export const notificationUnreadOf = unreadCountOf;

