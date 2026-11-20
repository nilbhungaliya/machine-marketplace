import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { notificationDeliveries, notifications, userDevices, users } from '../../db/schema.js';
import { queueUserEmit, runJobTx, type TxApp } from '../../lib/tx-effects.js';
import { isViewing } from '../chat/viewing.js';
import { deleteDevice } from './devices.service.js';
import { notificationUnreadOf } from './notify.js';
import { getPushProvider, type PushMessage, type PushProvider, type PushResult } from './push-provider.js';
import { renderNotification } from './render.js';

/**
 * Push delivery (F6 + F7 spec §11.5–§11.6; ported from textile `services/notifications/push-sender.ts`). L4-4 owns this
 * file. Run from `jobs/index.ts` (`notification-push`, every 3 s). At least once:
 * 1. a batch of ≤ 100 due `queued` deliveries is claimed `FOR UPDATE SKIP LOCKED` and leased (`attempts + 1`,
 *    `next_attempt_at = now() + 2 min`) in one short transaction, so a concurrent run never takes the same rows;
 * 2. each is rendered in the recipient's language and sent outside any transaction, then its outcome written.
 * A crash mid-send leaves the row `queued` with its lease: it is sent again with the same delivery key, which the app
 * drops (§11.5). Skipped instead of sent: the row already read, a newer version of it exists, push switched off, the
 * user no longer active, or a chat push while the recipient is viewing that thread (the row is then marked read).
 * Logs carry ids and states only, never text or tokens (§19).
 */

const BATCH = 100;
const LEASE = sql`interval '2 minutes'`;
/** Gaps after the 1st–4th failed attempt; the 5th failure is `failed`. */
export const PUSH_BACKOFF_SECONDS = [15, 60, 300, 1800] as const;
export const PUSH_MAX_ATTEMPTS = PUSH_BACKOFF_SECONDS.length + 1;
/** One provider call longer than this counts as a transient error. */
export const PUSH_SEND_TIMEOUT_MS = 10_000;

export type PushApp = TxApp & { redis?: Redis };

export interface PushRunResult {
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
}

async function claim(app: PushApp): Promise<Array<{ id: string; attempts: number }>> {
  const { rows } = await app.db.execute(sql`
    UPDATE notification_deliveries d
       SET attempts = d.attempts + 1, next_attempt_at = now() + ${LEASE}
     WHERE d.id IN (
       SELECT id FROM notification_deliveries
        WHERE state = 'queued' AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
    RETURNING d.id, d.attempts`);
  return (rows as Array<{ id: string; attempts: number }>).map((r) => ({ id: r.id, attempts: Number(r.attempts) }));
}

async function finish(
  app: PushApp,
  id: string,
  state: 'sent' | 'sent_dev' | 'failed' | 'skipped',
  extra: { providerMessageId?: string; lastError?: string } = {},
): Promise<void> {
  await app.db
    .update(notificationDeliveries)
    .set({ state, providerMessageId: extra.providerMessageId ?? null, lastError: extra.lastError ?? null })
    .where(eq(notificationDeliveries.id, id));
}

async function retryLater(app: PushApp, id: string, attempts: number, error: string): Promise<'failed' | 'retried'> {
  if (attempts >= PUSH_MAX_ATTEMPTS) {
    await finish(app, id, 'failed', { lastError: error });
    return 'failed';
  }
  const gap = PUSH_BACKOFF_SECONDS[Math.max(0, attempts - 1)]!;
  await app.db
    .update(notificationDeliveries)
    .set({ nextAttemptAt: sql`now() + make_interval(secs => ${gap}::int)`, lastError: error })
    .where(eq(notificationDeliveries.id, id));
  return 'retried';
}

/** The viewing user read the thread on screen: the grouped row is marked read (§11.5) and the badge updated. */
async function markReadWhileViewing(app: PushApp, notificationId: string, userId: string): Promise<void> {
  await runJobTx(app, async (tx) => {
    const done = await tx
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(eq(notifications.id, notificationId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    if (done.length) queueUserEmit(tx, userId, 'notification:new', { unreadCount: await notificationUnreadOf(tx, userId) });
  });
}

/** F8 (spec §10.2): the grouped request rows, whose pushed updates replace the one shown. */
const GROUPED_REQUEST_TYPES = new Set(['part_match', 'part_request_reply']);

/**
 * Android tag: `thread:<id>` for chat, `part_request:<id>:<type>` for F8's grouped rows, `rental:<bookingId>` for a
 * booking's updates (M14 §11: each replaces the last one shown), else the notification id.
 */
function pushTag(n: typeof notifications.$inferSelect): string {
  if (n.type === 'message_new' && n.threadId) return `thread:${n.threadId}`;
  if (GROUPED_REQUEST_TYPES.has(n.type) && n.partRequestId) return `part_request:${n.partRequestId}:${n.type}`;
  if (n.type.startsWith('rental_booking_') && n.rentalBookingId) return `rental:${n.rentalBookingId}`;
  return n.id;
}

/** The provider message for a row: rendered text (no message text exists in params) and id-only data. */
export function pushMessageFor(
  n: typeof notifications.$inferSelect,
  delivery: { version: number },
  token: string,
  language: (typeof users.$inferSelect)['language'],
): PushMessage {
  const { title, body } = renderNotification(n.type, n.params, language, n.unreadCount);
  const tag = pushTag(n);
  // M14 §11: `rentalBookingId` opens the Booking record (the FCM provider passes every string value through).
  const data: PushMessage['data'] & { rentalBookingId?: string } = {
    notificationId: n.id,
    type: n.type,
    deliveryKey: `${n.id}:${delivery.version}`,
    tag,
  };
  if (n.threadId) data.threadId = n.threadId;
  if (n.offerId) data.offerId = n.offerId;
  if (n.dealId) data.dealId = n.dealId;
  if (n.reviewId) data.reviewId = n.reviewId;
  if (n.partRequestId) data.partRequestId = n.partRequestId;
  if (n.rentalBookingId) data.rentalBookingId = n.rentalBookingId;
  return { token, title, body, tag, data };
}

/** One run of the `notification-push` job. `opts.provider` / `sendTimeoutMs` replace the defaults (tests). */
export async function sendDuePushes(
  app: PushApp,
  opts: { provider?: PushProvider; sendTimeoutMs?: number } = {},
): Promise<PushRunResult> {
  const result: PushRunResult = { sent: 0, skipped: 0, failed: 0, retried: 0 };
  const claimed = await claim(app);
  if (claimed.length === 0) return result;
  const provider = opts.provider ?? getPushProvider();

  for (const { id, attempts } of claimed) {
    try {
      const [row] = await app.db
        .select({
          delivery: notificationDeliveries,
          n: notifications,
          token: userDevices.fcmToken,
          language: users.language,
          pushEnabled: users.pushEnabled,
          status: users.status,
        })
        .from(notificationDeliveries)
        .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
        .innerJoin(userDevices, eq(userDevices.id, notificationDeliveries.deviceId))
        .innerJoin(users, eq(users.id, notifications.userId))
        .where(eq(notificationDeliveries.id, id));
      if (!row) continue; // its device or notification went meanwhile (cascade)
      const { n, delivery } = row;

      let skip = n.readAt !== null || delivery.version < n.version || !row.pushEnabled || row.status !== 'active';
      if (!skip && n.type === 'message_new' && n.threadId && app.redis && (await isViewing(app.redis, n.userId, n.threadId))) {
        await markReadWhileViewing(app, n.id, n.userId);
        skip = true;
      }
      if (skip) {
        await finish(app, id, 'skipped');
        result.skipped++;
        continue;
      }

      let outcome: PushResult;
      let timer: NodeJS.Timeout | undefined;
      try {
        // A hung provider call must not hold the batch: past the timeout it is retried (same delivery key).
        const timeout = new Promise<PushResult>((resolve) => {
          timer = setTimeout(() => resolve({ kind: 'retry', error: 'timeout' }), opts.sendTimeoutMs ?? PUSH_SEND_TIMEOUT_MS);
        });
        outcome = await Promise.race([provider.send(pushMessageFor(n, delivery, row.token, row.language)), timeout]);
      } catch {
        // Unknown: the provider may have accepted it. Retried with the same delivery key, which the app drops.
        outcome = { kind: 'retry', error: 'send_threw' };
      } finally {
        clearTimeout(timer);
      }

      switch (outcome.kind) {
        case 'sent':
          await finish(app, id, 'sent', { providerMessageId: outcome.messageId });
          result.sent++;
          break;
        case 'sent_dev':
          await finish(app, id, 'sent_dev');
          app.log.info({ job: 'notification-push', deliveryId: id, notificationId: n.id, type: n.type }, 'push sent (dev stub)');
          result.sent++;
          break;
        case 'skipped':
          await finish(app, id, 'skipped');
          result.skipped++;
          break;
        case 'unregistered':
          await deleteDevice(app.db, delivery.deviceId);
          app.log.info({ job: 'notification-push', deviceId: delivery.deviceId }, 'push token gone: device deleted');
          result.failed++;
          break;
        case 'failed':
          await finish(app, id, 'failed', { lastError: outcome.error });
          result.failed++;
          break;
        case 'retry':
          result[await retryLater(app, id, attempts, outcome.error)]++;
          break;
      }
    } catch (err) {
      // One delivery's failure (Redis, a write) never strands the batch under the lease.
      app.log.warn({ err, job: 'notification-push', deliveryId: id }, 'push delivery errored');
      await retryLater(app, id, attempts, 'internal').catch(() => undefined);
    }
  }
  return result;
}
