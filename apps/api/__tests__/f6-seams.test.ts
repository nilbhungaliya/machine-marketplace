import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import Fastify from 'fastify';
import authPlugin from '../src/plugins/auth.js';
import errorHandlerPlugin from '../src/plugins/error-handler.js';
import redisPlugin from '../src/plugins/redis.js';
import { db } from '../src/db/index.js';
import { chatThreads, chatThreadUserState, users } from '../src/db/schema.js';
import { groupRateLimit } from '../src/lib/group-limit.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { emitToThreadMembers } from '../src/services/chat/chat-emit.js';
import { visibleText } from '../src/services/chat/chat-view.js';
import { assertCanWrite, getThreadForParty } from '../src/services/chat/members.js';
import { openOrGetThread } from '../src/services/chat/open-thread.js';
import { insertMessage, insertSystemLine, recomputeTurns } from '../src/services/chat/thread-lines.js';
import { notify } from '../src/services/notifications/notify.js';
import { getThreadDetail } from '../src/services/chat/thread.service.js';
import { getDealView } from '../src/services/deals/deal-read.service.js';
import { userRoom } from '../src/socket/rooms.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { addTestMember, insertTestDeal, insertTestOffer, insertTestThread } from './_helpers/test-deals.js';

// The F6 + F7 seams every lane builds on (plan C0-4a): per-reader emits, masking, opening a thread, the message writer,
// turns, notify, party checks and the group rate limit.

let seller: TestSeller;
let buyer: TestBusinessUser;
let third: TestBusinessUser;
let viewer: { userId: string; token: string };
let suspended: { userId: string; token: string };
const sellers: TestSeller[] = [];
const businessIds: string[] = [];

const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
const fakeIo = { of: () => ({ to: (room: string) => ({ emit: (event: string, payload: unknown) => void emitted.push({ room, event, payload }) }) }) };
const txApp = { db, io: fakeIo, log: { warn: () => undefined } } as unknown as TxApp;

const tokenUser = (u: { userId: string; businessId: string }) => ({ userId: u.userId, businessId: u.businessId });

async function liveListing(status: 'live' | 'paused' = 'live', quantity = '10'): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status, quantity, priceModel: 'negotiable', pricePaise: 100_000,
  });
  return id;
}

async function threadRow(id: string) {
  const [t] = await db.select().from(chatThreads).where(eq(chatThreads.id, id));
  return t!;
}

beforeAll(async () => {
  seller = await createTestSeller();
  sellers.push(seller);
  buyer = await createTestBusinessUser();
  third = await createTestBusinessUser();
  businessIds.push(seller.businessId, buyer.businessId, third.businessId);
  viewer = await addTestMember(buyer.businessId, 'viewer');
  suspended = await addTestMember(buyer.businessId, 'sales');
  await db.update(users).set({ status: 'suspended' }).where(eq(users.id, suspended.userId));
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras(sellers);
});

describe('emitToThreadMembers', () => {
  it('queues one payload per active member of both businesses, built per reader; a suspended member is skipped', async () => {
    const thread = await insertTestThread({ listingId: await liveListing(), buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    emitted.length = 0;
    await runTx(txApp, (tx) => emitToThreadMembers(tx, thread, 'test:event', (r) => ({ role: r.memberRole, side: r.side })));
    const byRoom = new Map(emitted.map((e) => [e.room, e.payload]));
    expect(byRoom.get(userRoom(buyer.userId))).toEqual({ role: 'owner', side: 'buyer' });
    expect(byRoom.get(userRoom(viewer.userId))).toEqual({ role: 'viewer', side: 'buyer' });
    expect(byRoom.get(userRoom(seller.userId))).toEqual({ role: 'owner', side: 'seller' });
    expect(byRoom.has(userRoom(suspended.userId))).toBe(false);
    expect(byRoom.has(userRoom(third.userId))).toBe(false);
    expect(emitted).toHaveLength(3);
  });
});

describe('visibleText', () => {
  const text = 'call 9876543210';
  it.each([
    [null, 'owner', true],
    [null, 'sales', true],
    [null, 'viewer', true],
    [new Date(), 'owner', false],
    [new Date(), 'sales', false],
    [new Date(), 'viewer', true],
  ] as const)('unlocked %s, %s → masked %s', (unlockedAt, memberRole, masked) => {
    const out = visibleText(text, { memberRole }, { contactUnlockedAt: unlockedAt });
    expect(out === text).toBe(!masked);
  });
});

describe('openOrGetThread', () => {
  it('makes one thread for two concurrent first calls', async () => {
    const listingId = await liveListing();
    const [a, b] = await Promise.all([
      db.transaction((tx) => openOrGetThread(tx, tokenUser(buyer), listingId)),
      db.transaction((tx) => openOrGetThread(tx, tokenUser(buyer), listingId)),
    ]);
    expect(a.thread.id).toBe(b.thread.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
  });

  it('refuses the own listing, a viewer, a block and a non-public listing', async () => {
    const listingId = await liveListing();
    await expect(db.transaction((tx) => openOrGetThread(tx, tokenUser(seller), listingId))).rejects.toMatchObject({ statusCode: 409, code: 'OWN_LISTING' });
    await expect(
      db.transaction((tx) => openOrGetThread(tx, { userId: viewer.userId, businessId: buyer.businessId }, listingId)),
    ).rejects.toMatchObject({ statusCode: 403, code: 'VIEWER_READ_ONLY' });
    await db.execute(sql`INSERT INTO business_blocks (blocker_business_id, blocked_business_id, created_by_user_id) VALUES (${seller.businessId}, ${third.businessId}, ${seller.userId})`);
    try {
      await expect(db.transaction((tx) => openOrGetThread(tx, tokenUser(third), listingId))).rejects.toMatchObject({ statusCode: 403, code: 'BUSINESS_BLOCKED' });
    } finally {
      await db.execute(sql`DELETE FROM business_blocks WHERE blocker_business_id = ${seller.businessId}`);
    }
    const paused = await liveListing('paused');
    await expect(db.transaction((tx) => openOrGetThread(tx, tokenUser(buyer), paused))).rejects.toMatchObject({ statusCode: 404, code: 'LISTING_NOT_FOUND' });
  });
});

describe('insertMessage / insertSystemLine', () => {
  it('moves the per-side seqs, raises both for a system line, sets first_seller_reply_at once and un-archives the receiver only', async () => {
    const thread = await insertTestThread({ listingId: await liveListing(), buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    await db.insert(chatThreadUserState).values([
      { threadId: thread.id, userId: buyer.userId, archivedAt: new Date() },
      { threadId: thread.id, userId: seller.userId, archivedAt: new Date() },
    ]);
    const m1 = await runTx(txApp, (tx) => insertMessage(tx, thread, { kind: 'text', senderSide: 'buyer', senderUserId: buyer.userId, text: 'hi' }));
    let t = await threadRow(thread.id);
    expect([t.lastMessageSeq, t.lastBuyerSeq, t.lastSellerSeq]).toEqual([m1.seq, m1.seq, 0]);
    expect(t.firstSellerReplyAt).toBeNull();
    const states = await db.select().from(chatThreadUserState).where(eq(chatThreadUserState.threadId, thread.id));
    expect(states.find((s) => s.userId === seller.userId)!.archivedAt).toBeNull();
    expect(states.find((s) => s.userId === buyer.userId)!.archivedAt).not.toBeNull();

    const m2 = await runTx(txApp, (tx) => insertMessage(tx, t, { kind: 'text', senderSide: 'seller', senderUserId: seller.userId, text: 'yes' }));
    t = await threadRow(thread.id);
    expect(m2.seq).toBeGreaterThan(m1.seq);
    expect([t.lastBuyerSeq, t.lastSellerSeq]).toEqual([m1.seq, m2.seq]);
    const firstReply = t.firstSellerReplyAt;
    expect(firstReply).not.toBeNull();

    await runTx(txApp, (tx) => insertMessage(tx, t, { kind: 'text', senderSide: 'seller', senderUserId: seller.userId, text: 'again' }));
    const m4 = await runTx(txApp, (tx) => insertSystemLine(tx, thread.id, 'offer_expired', { offerId: randomUUID() }));
    t = await threadRow(thread.id);
    expect([t.lastMessageSeq, t.lastBuyerSeq, t.lastSellerSeq]).toEqual([m4.seq, m4.seq, m4.seq]);
    expect(t.firstSellerReplyAt!.getTime()).toBe(firstReply!.getTime());
  });
});

describe('recomputeTurns', () => {
  it('follows the open enquiry, the pending offer and the deals', async () => {
    // 1. A new thread with no seller reply: the seller's turn (open enquiry).
    const t1 = await insertTestThread({ listingId: await liveListing(), buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    expect(await db.transaction((tx) => recomputeTurns(tx, t1.id))).toEqual({ buyer: false, seller: true });
    // 2. Replied, a pending counter waiting on the buyer.
    await db.update(chatThreads).set({ firstSellerReplyAt: new Date() }).where(eq(chatThreads.id, t1.id));
    await insertTestOffer({ threadId: t1.id, pricePerUnitPaise: 90_000, quantity: '1', turn: 'buyer', senderSide: 'seller', senderUserId: seller.userId });
    expect(await db.transaction((tx) => recomputeTurns(tx, t1.id))).toEqual({ buyer: true, seller: false });
    expect((await threadRow(t1.id)).buyerTurn).toBe(true);
    // 3. An agreed deal: the seller hands over.
    const d = await insertTestDeal({ listing: { id: await liveListing() }, buyer, quantity: '1', pricePerUnitPaise: 100_000, status: 'agreed' });
    await db.update(chatThreads).set({ firstSellerReplyAt: new Date() }).where(eq(chatThreads.id, d.threadId));
    expect(await db.transaction((tx) => recomputeTurns(tx, d.threadId))).toEqual({ buyer: false, seller: true });
    // 4. Handed over: the buyer confirms.
    await db.execute(sql`UPDATE deals SET status = 'handed_over', handed_over_at = now(), auto_complete_at = now() + interval '7 days' WHERE id = ${d.dealId}`);
    expect(await db.transaction((tx) => recomputeTurns(tx, d.threadId))).toEqual({ buyer: true, seller: false });
    // 5. The buyer asked to cancel: it waits on the seller only.
    await db.execute(sql`UPDATE deals SET cancel_requested_side = 'buyer', cancel_requested_at = now(), cancel_requested_reason = 'changed_mind', cancel_requested_by_user_id = ${buyer.userId} WHERE id = ${d.dealId}`);
    expect(await db.transaction((tx) => recomputeTurns(tx, d.threadId))).toEqual({ buyer: false, seller: true });
  });
});

describe('notify', () => {
  it('writes one row per active member (viewer included), a repeat is a no-op, deliveries only for push-enabled devices', async () => {
    const thread = await insertTestThread({ listingId: await liveListing(), buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    await db.update(users).set({ pushEnabled: false }).where(eq(users.id, viewer.userId));
    const install = randomUUID();
    await db.execute(sql`INSERT INTO user_devices (user_id, install_id, fcm_token, platform) VALUES
      (${buyer.userId}, ${`a-${install}`}, 'tok-a', 'android'), (${viewer.userId}, ${`b-${install}`}, 'tok-b', 'android')`);
    const input = {
      type: 'offer_new' as const,
      recipientBusinessId: buyer.businessId,
      params: { businessName: 'Seller Co' },
      destination: { threadId: thread.id },
      dedupeKey: `offer_new:${thread.id}`,
    };
    emitted.length = 0;
    const ids = await runTx(txApp, (tx) => notify(tx, input));
    expect(ids).toHaveLength(2);
    const rows = (await db.execute(sql`SELECT user_id, business_id FROM notifications WHERE dedupe_key = ${input.dedupeKey}`)).rows as Array<{ user_id: string; business_id: string }>;
    expect(rows.map((r) => r.user_id).sort()).toEqual([buyer.userId, viewer.userId].sort());
    expect(rows.every((r) => r.business_id === buyer.businessId)).toBe(true);
    const deliveries = (await db.execute(sql`
      SELECT d.device_id, u.user_id FROM notification_deliveries d JOIN user_devices u ON u.id = d.device_id
      WHERE d.notification_id IN (SELECT id FROM notifications WHERE dedupe_key = ${input.dedupeKey})`)).rows as Array<{ user_id: string }>;
    expect(deliveries.map((d) => d.user_id)).toEqual([buyer.userId]);
    expect(emitted.filter((e) => e.event === 'notification:new').map((e) => e.room).sort()).toEqual([userRoom(buyer.userId), userRoom(viewer.userId)].sort());
    expect(await runTx(txApp, (tx) => notify(tx, input))).toEqual([]);
  });
});

describe('getThreadForParty / assertCanWrite', () => {
  it('hides the thread from a third business and refuses a viewer’s write', async () => {
    const thread = await insertTestThread({ listingId: await liveListing(), buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    await expect(getThreadForParty(db, tokenUser(third), thread.id)).rejects.toMatchObject({ statusCode: 404, code: 'THREAD_NOT_FOUND' });
    const { reader } = await getThreadForParty(db, { userId: viewer.userId, businessId: buyer.businessId }, thread.id);
    expect(reader).toMatchObject({ memberRole: 'viewer', side: 'buyer' });
    expect(() => assertCanWrite(reader)).toThrow(expect.objectContaining({ statusCode: 403, code: 'VIEWER_READ_ONLY' }));
  });
});

describe('wave A seams: thread detail and the Deal record', () => {
  it('thread detail carries the open offer as each reader sees it (note masked, seller may answer) and the thread’s deal rows', async () => {
    const d = await insertTestDeal({ listing: { id: await liveListing() }, buyer, quantity: '1', pricePerUnitPaise: 100_000, status: 'agreed' });
    const open = await insertTestOffer({ threadId: d.threadId, pricePerUnitPaise: 95_000, quantity: '2', note: 'Call me on 9876543210' });

    const asSeller = await getThreadDetail(db, tokenUser(seller), d.threadId);
    expect(asSeller.openNegotiation).toMatchObject({ id: open.id, isMine: false, turn: 'seller' });
    expect(asSeller.openNegotiation!.note).not.toContain('9876543210');
    expect(asSeller.openNegotiation!.actions).toContain('accept');
    expect(asSeller.deals.map((r) => [r.id, r.side, r.status])).toEqual([[d.dealId, 'seller', 'agreed']]);

    const asViewer = await getThreadDetail(db, { userId: viewer.userId, businessId: buyer.businessId }, d.threadId);
    expect(asViewer.openNegotiation).toMatchObject({ id: open.id, isMine: true, actions: [] });
    expect(asViewer.deals[0]).toMatchObject({ id: d.dealId, side: 'buyer' });
  });

  it('the Deal record carries the review state once completed: `review` offered to a member, never to a viewer', async () => {
    const agreed = await insertTestDeal({ listing: { id: await liveListing() }, buyer, quantity: '1', pricePerUnitPaise: 100_000, status: 'agreed' });
    const before = await getDealView(db, tokenUser(buyer), agreed.dealId);
    expect(before.review).toBeNull();
    expect(before.actions).not.toContain('review');

    const done = await insertTestDeal({ listing: { id: await liveListing() }, buyer, quantity: '1', pricePerUnitPaise: 100_000, status: 'completed' });
    const mine = await getDealView(db, tokenUser(buyer), done.dealId);
    expect(mine.review).toMatchObject({ dealId: done.dealId, mySide: 'buyer', eligible: true, reason: null, mine: null });
    expect(mine.actions).toContain('review');

    const asViewer = await getDealView(db, { userId: viewer.userId, businessId: buyer.businessId }, done.dealId);
    expect(asViewer.review).toMatchObject({ eligible: false, reason: 'viewer' });
    expect(asViewer.actions).not.toContain('review');
  });
});

describe('groupRateLimit', () => {
  let limited: FastifyInstance;
  beforeAll(async () => {
    vi.stubEnv('GROUP_RATE_LIMIT_MAX', '3');
    try {
      // A bare app sharing the pool (buildApp's db plugin would end the shared pool on close).
      limited = Fastify({ logger: false });
      limited.decorate('db', db);
      await limited.register(errorHandlerPlugin);
      await limited.register(authPlugin);
      await limited.register(redisPlugin);
      for (const path of ['/__test/offer-a', '/__test/offer-b']) {
        limited.post(path, { preHandler: [limited.requireUser, groupRateLimit('offer', 20, 60)] }, async () => ({ data: true }));
      }
      await limited.ready();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  afterAll(async () => {
    await limited.redis?.del(`${process.env.DISCOVERY_REDIS_PREFIX ?? ''}rl:offer:${third.userId}`);
    await limited.close();
  });

  it('answers 429 on the 4th offer write across two routes', async () => {
    const hit = (path: string) => limited.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${third.token}` } });
    expect((await hit('/__test/offer-a')).statusCode).toBe(200);
    expect((await hit('/__test/offer-b')).statusCode).toBe(200);
    expect((await hit('/__test/offer-a')).statusCode).toBe(200);
    const fourth = await hit('/__test/offer-b');
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().code).toBe('RATE_LIMITED');
  });
});
