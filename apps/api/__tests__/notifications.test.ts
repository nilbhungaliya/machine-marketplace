import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { LANGUAGES, NOTIFICATION_TYPES } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { chatThreads, notificationDeliveries, notifications, userDevices, users } from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { markChatNotificationRead, upsertChatNotification } from '../src/services/notifications/chat-rows.js';
import { notify } from '../src/services/notifications/notify.js';
import { renderNotification } from '../src/services/notifications/render.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { insertTestThread } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// L4-3 (spec §11.2–§11.4, §11.6): no number, email or message text in rendered text (en / hi / gu), every type renders,
// the grouped chat row under a race, read → a new row, push off → rows without deliveries, the language switch, read
// state and ownership.

const fakeIo = { of: () => ({ to: () => ({ emit: () => undefined }) }) };
const txApp = { db, io: fakeIo, log: { warn: () => undefined, info: () => undefined } } as unknown as TxApp;

const PHONE = '+91 98765 43210';
const EMAIL = 'rahul@gmail.com';
const NAME = `Kamal Earthmovers ${PHONE}`;
const TITLE = `Hydraulic pump, mail ${EMAIL} or call ${PHONE}`;

let app: FastifyInstance;
let seller: TestSeller;
let buyer: TestBusinessUser;
let other: TestBusinessUser;

const call = (method: 'GET' | 'POST' | 'PUT', url: string, token: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

async function thread() {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'live', quantity: '10', priceModel: 'negotiable', pricePaise: 100_000,
  });
  return insertTestThread({ listingId: id, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
}

const openChatRows = (userId: string, threadId: string) =>
  db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.threadId, threadId), eq(notifications.type, 'message_new')));

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  seller = await createTestSeller();
  buyer = await createTestBusinessUser();
  other = await createTestBusinessUser();
});

afterAll(async () => {
  await deleteTestBusinesses([seller.businessId, buyer.businessId, other.businessId]);
  await deleteTestSellerExtras([seller]);
  await app.close();
});

describe('renderNotification (§11.4)', () => {
  it.each(LANGUAGES)('never shows a phone number or an email in %s', (language) => {
    const params = { businessName: NAME, listingTitle: TITLE, pricePerUnitPaise: 1_234_500, quantity: '5', unitLabel: 'pieces', dealRef: 500_123 };
    for (const type of ['message_new', 'offer_new', 'deal_handed_over'] as const) {
      const { title, body } = renderNotification(type, params, language, 3);
      const text = `${title} ${body}`;
      expect(text).not.toMatch(/98765|43210/);
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain('gmail');
    }
    expect(renderNotification('enquiry_new', { listingTitle: TITLE }, language).body).toBe(
      'Hydraulic pump, mail •••@••• or call ••••••••••',
    );
  });

  it('renders a non-empty title and body for every type in every language', () => {
    for (const language of LANGUAGES) {
      for (const type of NOTIFICATION_TYPES) {
        const { title, body } = renderNotification(type, {}, language);
        expect(title.trim(), `${type} ${language}`).not.toBe('');
        expect(body.trim(), `${type} ${language}`).not.toBe('');
      }
    }
  });
});

describe('grouped chat rows (§11.2)', () => {
  it('keeps one row for two concurrent messages, bumps it, and starts a new one after a read; never the sender’s business', async () => {
    const t = await thread();
    const install = randomUUID();
    await db.insert(userDevices).values({ userId: seller.userId, installId: `i-${install}`, fcmToken: `tok-${install}`, platform: 'android' });
    // As in production (L1): each message allocates its seq under the thread row lock in the transaction that upserts
    // the row, so seqs commit in order whichever call starts first.
    const send = () =>
      runTx(txApp, async (tx) => {
        const [{ seq }] = await tx
          .update(chatThreads)
          .set({ lastMessageSeq: sql`${chatThreads.lastMessageSeq} + 1` })
          .where(eq(chatThreads.id, t.id))
          .returning({ seq: chatThreads.lastMessageSeq }) as [{ seq: number }];
        await upsertChatNotification(tx, { thread: t, recipientBusinessId: seller.businessId, senderBusinessName: NAME, seq });
      });
    await Promise.all([send(), send()]);
    let rows = await openChatRows(seller.userId, t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ unreadCount: 2, version: 2, lastSeq: 2, readAt: null });
    expect(await openChatRows(buyer.userId, t.id)).toHaveLength(0);
    // One delivery per version (the push key `<id>:<version>`).
    const deliveries = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.notificationId, rows[0]!.id));
    expect(deliveries.map((d) => d.version).sort()).toEqual([1, 2]);
    // A repeat of an older seq changes nothing.
    await runTx(txApp, (tx) => upsertChatNotification(tx, { thread: t, recipientBusinessId: seller.businessId, senderBusinessName: NAME, seq: 2 }));
    expect((await openChatRows(seller.userId, t.id))[0]).toMatchObject({ unreadCount: 2, version: 2 });

    await runTx(txApp, (tx) => markChatNotificationRead(tx, seller.userId, t.id));
    await runTx(txApp, (tx) => upsertChatNotification(tx, { thread: t, recipientBusinessId: seller.businessId, senderBusinessName: NAME, seq: 3 }));
    rows = await openChatRows(seller.userId, t.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.readAt === null)).toMatchObject({ unreadCount: 1, version: 1, lastSeq: 3 });
  });

  it('writes rows but no deliveries for a user with push off', async () => {
    const t = await thread();
    const install = randomUUID();
    await db.insert(userDevices).values({ userId: buyer.userId, installId: `i-${install}`, fcmToken: `tok-${install}`, platform: 'android' });
    await db.update(users).set({ pushEnabled: false }).where(eq(users.id, buyer.userId));
    try {
      await runTx(txApp, (tx) => upsertChatNotification(tx, { thread: t, recipientBusinessId: buyer.businessId, senderBusinessName: 'Seller', seq: 1 }));
      await runTx(txApp, (tx) =>
        notify(tx, { type: 'offer_quote', recipientBusinessId: buyer.businessId, params: {}, destination: { threadId: t.id }, dedupeKey: `offer_quote:${t.id}` }),
      );
      const ids = (await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, buyer.userId), eq(notifications.threadId, t.id)))).map((r) => r.id);
      expect(ids).toHaveLength(2);
      expect(await db.select().from(notificationDeliveries).where(inArray(notificationDeliveries.notificationId, ids))).toHaveLength(0);
    } finally {
      await db.update(users).set({ pushEnabled: true }).where(eq(users.id, buyer.userId));
    }
  });
});

describe('routes (§11.6, §12.2)', () => {
  it('renders the list in the user’s language, reads one and all, and hides other users’ rows', async () => {
    const t = await thread();
    await runTx(txApp, (tx) =>
      notify(tx, {
        type: 'deal_completed',
        recipientBusinessId: other.businessId,
        params: { listingTitle: 'Gear', dealRef: 500_001 },
        destination: { threadId: t.id },
        dedupeKey: `deal_completed:${t.id}`,
      }),
    );
    await runTx(txApp, (tx) =>
      notify(tx, { type: 'enquiry_new', recipientBusinessId: other.businessId, params: { listingTitle: 'Gear' }, destination: { threadId: t.id }, dedupeKey: `enquiry_new:${t.id}` }),
    );

    expect((await call('PUT', '/users/me/language', other.token, { language: 'hi' })).statusCode).toBe(200);
    const list = (await call('GET', '/notifications', other.token)).json().data;
    expect(list.unreadCount).toBe(2);
    expect(list.items.map((i: { title: string }) => i.title).sort()).toEqual(['डील पूरी', 'नई पूछताछ'].sort());

    // Another user's row is a 404.
    const id = list.items[0].id as string;
    const foreign = await call('POST', `/notifications/${id}/read`, buyer.token);
    expect(foreign.statusCode).toBe(404);

    expect((await call('POST', `/notifications/${id}/read`, other.token)).json().data).toEqual({ unreadCount: 1 });
    expect((await call('POST', '/notifications/read-all', other.token)).json().data).toEqual({ unreadCount: 0 });
    expect((await call('GET', '/notifications/unread-count', other.token)).json().data).toEqual({ unreadCount: 0 });

    expect((await call('PUT', '/notifications/preferences', other.token, { push: false })).json().data).toEqual({ push: false });
    expect((await call('GET', '/notifications/preferences', other.token)).json().data).toEqual({ push: false });
    await db.update(users).set({ language: 'en', pushEnabled: true }).where(eq(users.id, other.userId));
  });
});
