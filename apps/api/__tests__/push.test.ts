import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import type { NotificationType } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { notificationDeliveries, notifications, userDevices } from '../src/db/schema.js';
import { runTx } from '../src/lib/tx-effects.js';
import { setViewing } from '../src/services/chat/viewing.js';
import { upsertChatNotification } from '../src/services/notifications/chat-rows.js';
import { registerDevice } from '../src/services/notifications/devices.service.js';
import { notify } from '../src/services/notifications/notify.js';
import { pushProviderFromEnv, type PushMessage, type PushProvider, type PushResult } from '../src/services/notifications/push-provider.js';
import { sendDuePushes, type PushApp } from '../src/services/notifications/push-sender.js';
import { deleteOldNotifications } from '../src/services/notifications/retention.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { insertTestThread } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// L4-4 (spec §11.5–§11.6): opt-in push (dev stub `sent_dev`, production without keys `skipped`), no text in the
// provider payload, viewing skips a chat push and reads its row, backoff then `failed`, an invalid token deletes the
// device, concurrent runs send once, one account per install, 90-day retention.

let app: FastifyInstance;
let pushApp: PushApp;
let seller: TestSeller;
let buyer: TestBusinessUser;
let second: TestBusinessUser;
const fakeIo = { of: () => ({ to: () => ({ emit: () => undefined }) }) };

function recorder(answer: (m: PushMessage) => PushResult = () => ({ kind: 'sent', messageId: 'm-1' }), delayMs = 0) {
  const sent: PushMessage[] = [];
  const provider: PushProvider = {
    name: 'fcm',
    send: async (m) => {
      sent.push(m);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return answer(m);
    },
  };
  return { sent, provider };
}

async function device(userId: string): Promise<string> {
  const install = randomUUID();
  await runTx(pushApp, (tx) => registerDevice(tx, userId, { installId: `i-${install}`, fcmToken: `tok-${install}`, platform: 'android' }));
  const [d] = await db.select({ id: userDevices.id }).from(userDevices).where(eq(userDevices.installId, `i-${install}`));
  return d!.id;
}

async function thread() {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'live', quantity: '10', priceModel: 'negotiable', pricePaise: 100_000,
  });
  return insertTestThread({ listingId: id, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
}

/** A notification to `businessId` with its deliveries queued; returns the notification ids. */
async function queued(businessId: string, type: NotificationType = 'offer_new', params: Record<string, string | number> = {}): Promise<string[]> {
  return runTx(pushApp, (tx) => notify(tx, { type, recipientBusinessId: businessId, params, destination: {}, dedupeKey: `${type}:${randomUUID()}` }));
}

async function deliveriesOf(notificationIds: string[]) {
  return db.select().from(notificationDeliveries).where(inArray(notificationDeliveries.notificationId, notificationIds));
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  pushApp = { db, io: fakeIo, log: { warn: () => undefined, info: () => undefined }, redis: app.redis } as unknown as PushApp;
  seller = await createTestSeller();
  buyer = await createTestBusinessUser();
  second = await createTestBusinessUser();
  await device(buyer.userId);
});

afterAll(async () => {
  await app.redis?.del(`${process.env.DISCOVERY_REDIS_PREFIX ?? ''}viewing:${buyer.userId}`);
  await deleteTestBusinesses([seller.businessId, buyer.businessId, second.businessId]);
  await deleteTestSellerExtras([seller]);
  await app.close();
});

describe('providers (opt-in, §11.5)', () => {
  it('records sent_dev without keys outside production, and skipped in production', async () => {
    expect(pushProviderFromEnv({ NODE_ENV: 'test' }).name).toBe('dev');
    expect(pushProviderFromEnv({ NODE_ENV: 'production' }).name).toBe('off');
    // A malformed key warns once without its value and behaves as no keys.
    const warnings: string[] = [];
    const bad = Buffer.from(JSON.stringify({ project_id: 'p', client_email: 'e' })).toString('base64');
    expect(pushProviderFromEnv({ NODE_ENV: 'production', FIREBASE_SERVICE_ACCOUNT_B64: bad }, (m) => warnings.push(m)).name).toBe('off');
    expect(pushProviderFromEnv({ NODE_ENV: 'test', FIREBASE_SERVICE_ACCOUNT_B64: 'not base64 json' }, (m) => warnings.push(m)).name).toBe('dev');
    expect(warnings).toHaveLength(2);
    expect(warnings.join(' ')).not.toContain(bad);

    const dev = await queued(buyer.businessId);
    await sendDuePushes(pushApp, { provider: pushProviderFromEnv({ NODE_ENV: 'development' }) });
    expect((await deliveriesOf(dev)).map((d) => d.state)).toEqual(['sent_dev']);

    const off = await queued(buyer.businessId);
    await sendDuePushes(pushApp, { provider: pushProviderFromEnv({ NODE_ENV: 'production' }) });
    expect((await deliveriesOf(off)).map((d) => d.state)).toEqual(['skipped']);
  });
});

describe('sendDuePushes', () => {
  it('sends ids and masked names only: no number, email or message text in the payload', async () => {
    const t = await thread();
    await runTx(pushApp, (tx) =>
      upsertChatNotification(tx, { thread: t, recipientBusinessId: buyer.businessId, senderBusinessName: 'Kamal 98765 43210 kamal@gmail.com', seq: 1 }),
    );
    const { sent, provider } = recorder();
    await sendDuePushes(pushApp, { provider });
    const mine = sent.filter((m) => m.data.threadId === t.id);
    expect(mine).toHaveLength(1);
    const payload = JSON.stringify(mine[0]);
    expect(payload).not.toMatch(/98765|43210|gmail/);
    expect(mine[0]).toMatchObject({ title: 'New message', tag: `thread:${t.id}`, data: { type: 'message_new', threadId: t.id } });
    expect(mine[0]!.data.deliveryKey).toMatch(/^[0-9a-f-]{36}:1$/);
  });

  it('skips a chat push while the user views the thread and reads its row; a non-chat push still goes', async () => {
    const t = await thread();
    await runTx(pushApp, (tx) => upsertChatNotification(tx, { thread: t, recipientBusinessId: buyer.businessId, senderBusinessName: 'Kamal', seq: 1 }));
    const other = await queued(buyer.businessId, 'offer_quote');
    await setViewing(app.redis!, buyer.userId, t.id);
    try {
      const { sent, provider } = recorder();
      await sendDuePushes(pushApp, { provider });
      const [chatRow] = await db.select().from(notifications).where(eq(notifications.threadId, t.id));
      expect(chatRow!.readAt).not.toBeNull();
      expect((await deliveriesOf([chatRow!.id])).map((d) => d.state)).toEqual(['skipped']);
      expect((await deliveriesOf(other)).map((d) => d.state)).toEqual(['sent']);
      expect(sent.some((m) => m.data.threadId === t.id)).toBe(false);
    } finally {
      await setViewing(app.redis!, buyer.userId, null);
    }
  });

  it('retries a transient error after 15 s, then 1 / 5 / 30 min, and fails on the fifth', async () => {
    const ids = await queued(buyer.businessId);
    const { provider } = recorder(() => ({ kind: 'retry', error: 'messaging/internal-error' }));
    await sendDuePushes(pushApp, { provider });
    const { rows } = await db.execute(sql`
      SELECT state, attempts, extract(epoch FROM next_attempt_at - now()) AS wait
        FROM notification_deliveries WHERE notification_id = ${ids[0]}`);
    const first = rows[0] as { state: string; attempts: number; wait: string };
    expect(first.state).toBe('queued');
    expect(Number(first.attempts)).toBe(1);
    expect(Number(first.wait)).toBeGreaterThan(13);
    expect(Number(first.wait)).toBeLessThan(16);

    for (let i = 2; i <= 5; i++) {
      await db.update(notificationDeliveries).set({ nextAttemptAt: sql`now() - interval '1 second'` }).where(inArray(notificationDeliveries.notificationId, ids));
      await sendDuePushes(pushApp, { provider });
    }
    const [last] = await deliveriesOf(ids);
    expect(last).toMatchObject({ state: 'failed', attempts: 5, lastError: 'messaging/internal-error' });
  });

  it('retries a provider call that hangs past the timeout', async () => {
    const ids = await queued(buyer.businessId);
    const hung: PushProvider = { name: 'fcm', send: () => new Promise<PushResult>(() => undefined) };
    await sendDuePushes(pushApp, { provider: hung, sendTimeoutMs: 50 });
    const [d] = await deliveriesOf(ids);
    expect(d).toMatchObject({ state: 'queued', attempts: 1, lastError: 'timeout' });
    await db.update(notificationDeliveries).set({ state: 'failed' }).where(inArray(notificationDeliveries.notificationId, ids));
  });

  it('deletes the device of an invalid token', async () => {
    const deviceId = await device(second.userId);
    const ids = await queued(second.businessId);
    const { provider } = recorder(() => ({ kind: 'unregistered' }));
    await sendDuePushes(pushApp, { provider });
    expect(await db.select().from(userDevices).where(eq(userDevices.id, deviceId))).toHaveLength(0);
    expect(await deliveriesOf(ids)).toHaveLength(0);
  });

  it('sends each delivery once when two runs overlap', async () => {
    const ids = [...(await queued(buyer.businessId)), ...(await queued(buyer.businessId)), ...(await queued(buyer.businessId))];
    const { sent, provider } = recorder(undefined, 30);
    await Promise.all([sendDuePushes(pushApp, { provider }), sendDuePushes(pushApp, { provider })]);
    const keys = sent.filter((m) => ids.includes(m.data.notificationId)).map((m) => m.data.deliveryKey);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect((await deliveriesOf(ids)).every((d) => d.state === 'sent')).toBe(true);
  });
});

describe('devices and retention (§11.6)', () => {
  it('moves an install to the account that registers it last', async () => {
    const installId = `i-${randomUUID()}`;
    await runTx(pushApp, (tx) => registerDevice(tx, buyer.userId, { installId, fcmToken: `tok-${installId}`, platform: 'android' }));
    await runTx(pushApp, (tx) => registerDevice(tx, second.userId, { installId, fcmToken: `tok-${installId}`, platform: 'android' }));
    const rows = await db.select().from(userDevices).where(eq(userDevices.installId, installId));
    expect(rows.map((r) => r.userId)).toEqual([second.userId]);
  });

  it('deletes a 91-day-old notification and keeps an 89-day-old one', async () => {
    const [oldId] = await queued(second.businessId, 'deal_completed');
    const [recentId] = await queued(second.businessId, 'deal_completed');
    await db.update(notifications).set({ createdAt: sql`now() - interval '91 days'`, updatedAt: sql`now() - interval '91 days'` }).where(eq(notifications.id, oldId!));
    await db.update(notifications).set({ createdAt: sql`now() - interval '89 days'`, updatedAt: sql`now() - interval '89 days'` }).where(eq(notifications.id, recentId!));
    expect(await deleteOldNotifications(db)).toBeGreaterThanOrEqual(1);
    const left = await db.select({ id: notifications.id }).from(notifications).where(inArray(notifications.id, [oldId!, recentId!]));
    expect(left.map((r) => r.id)).toEqual([recentId]);
  });
});
