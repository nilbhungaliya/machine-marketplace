import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { chatMessages, contactShareConsents, deals } from '../src/db/schema.js';
import { setupSocketIO } from '../src/socket/setup.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { addTestMember, insertTestDeal } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { deleteTestUsers, uniqueTestPhone } from './_helpers/test-users.js';
import { signUserToken } from '../src/plugins/auth.js';
import { signInWithPhone } from '../src/services/user.service.js';

// L1-4: masking end to end, share my number, the reveal, the contact number (F6 + F7 spec §6.5, §6.6, R6, §19).

let app: FastifyInstance;
let url: string;
let seller: TestSeller;
let buyer: TestBusinessUser;
let third: TestBusinessUser;
let sellerViewer: { userId: string; token: string };
let sellerSales: { userId: string; token: string };
let buyerSales: { userId: string; token: string };
const businessIds: string[] = [];
const sockets: Socket[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const PLAIN = 'call +91 98765 43210 or ९८७६५४३२१० or ૯૮૭૬૫૪૩૨૧૦, mail rahul@gmail.com';
const DIGIT_RUNS = ['98765', '९८७६५', '૯૮૭૬૫', 'rahul@gmail.com'];
const expectMasked = (text: string | null) => DIGIT_RUNS.forEach((d) => expect(text).not.toContain(d));
const expectPlain = (text: string | null) => expect(text).toBe(PLAIN);

async function newListing(): Promise<{ id: string }> {
  return insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'live', quantity: '10', priceModel: 'negotiable', pricePaise: 10_000,
  });
}

async function newThread(listingId: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: `/listings/${listingId}/enquiry`, headers: auth(buyer.token), payload: { quick: ['is_available'] } });
  return res.json().data.threadId;
}

const send = (token: string, threadId: string, text: string) =>
  app.inject({ method: 'POST', url: `/threads/${threadId}/messages`, headers: auth(token), payload: { clientMessageId: randomUUID(), text } });

const messages = async (token: string, threadId: string) =>
  (await app.inject({ method: 'GET', url: `/threads/${threadId}/messages`, headers: auth(token) })).json().data as Array<{ id: string; text: string | null }>;

const detail = async (token: string, threadId: string) => (await app.inject({ method: 'GET', url: `/threads/${threadId}`, headers: auth(token) })).json().data;

const share = (token: string, threadId: string) => app.inject({ method: 'POST', url: `/threads/${threadId}/share-contact`, headers: auth(token) });

async function client(token: string): Promise<Socket> {
  const socket = connect(`${url}/user`, { auth: { token }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', reject);
  });
  return socket;
}

/** The next `message:new` for `messageId` on a socket. */
function nextMessage(socket: Socket, messageId: () => string | undefined): Promise<{ message: { text: string | null }; row: { lastMessage: { text: string | null } } }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no message:new')), 5000);
    const seen: Array<{ message: { id: string } }> = [];
    const check = () => {
      const hit = seen.find((p) => p.message.id === messageId());
      if (hit) {
        clearTimeout(timer);
        resolve(hit as never);
      }
    };
    socket.on('message:new', (p) => {
      seen.push(p);
      check();
    });
    const poll = setInterval(() => {
      check();
      if (messageId()) clearInterval(poll);
    }, 20);
  });
}

/** Sends as the buyer and returns the REST reply plus what the seller owner's and viewer's sockets got. */
async function sendWatched(threadId: string, owner: Socket, viewer: Socket) {
  let id: string | undefined;
  const ownerGot = nextMessage(owner, () => id);
  const viewerGot = nextMessage(viewer, () => id);
  const res = await send(buyer.token, threadId, PLAIN);
  id = res.json().data.id;
  return { id: id!, owner: await ownerGot, viewer: await viewerGot };
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  setupSocketIO(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  seller = await createTestSeller();
  buyer = await createTestBusinessUser();
  third = await createTestBusinessUser();
  businessIds.push(seller.businessId, buyer.businessId, third.businessId);
  sellerViewer = await addTestMember(seller.businessId, 'viewer');
  sellerSales = await addTestMember(seller.businessId, 'sales');
  buyerSales = await addTestMember(buyer.businessId, 'sales');
});

afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras([seller]);
  // Consents are append-only: the purge in the cleanup helpers must have removed them too.
  const { rows } = await db.execute(sql`SELECT count(*)::int AS n FROM contact_share_consents WHERE business_id IN (${seller.businessId}, ${buyer.businessId})`);
  await app.close();
  expect((rows[0] as { n: number }).n).toBe(0);
});

describe('masking until a deal and both ticks', () => {
  it('masks per reader before the deal, after one tick and for a viewer after the reveal; reveal is permanent', async () => {
    const listing = await newListing();
    const threadId = await newThread(listing.id);
    const owner = await client(seller.token);
    const viewer = await client(sellerViewer.token);

    // No deal: masked in messages, the inbox preview and message:new; stored text unchanged.
    const before = await sendWatched(threadId, owner, viewer);
    expectMasked(before.owner.message.text);
    expectMasked(before.owner.row.lastMessage.text);
    expectMasked(before.viewer.message.text);
    expectMasked((await messages(seller.token, threadId)).find((m) => m.id === before.id)!.text);
    const [stored] = await db.select({ text: chatMessages.text }).from(chatMessages).where(eq(chatMessages.id, before.id));
    expect(stored!.text).toBe(PLAIN);
    const inbox = (await app.inject({ method: 'GET', url: '/threads', headers: auth(seller.token) })).json().data.items;
    expectMasked(inbox.find((r: { threadId: string }) => r.threadId === threadId).lastMessage.text);

    // A deal and the buyer's tick only: still masked.
    const deal = await insertTestDeal({ listing, buyer, quantity: '1', pricePerUnitPaise: 10_000 });
    expect(deal.threadId).toBe(threadId);
    const buyerTick = await share(buyer.token, threadId);
    expect(buyerTick.statusCode).toBe(200);
    expect(buyerTick.json().data).toEqual({ revealed: false, number: null });
    expect((await detail(seller.token, threadId)).contact).toMatchObject({ mine: false, theirs: true, revealed: false, number: null, canTick: true });
    expectMasked((await messages(seller.token, threadId)).find((m) => m.id === before.id)!.text);

    // The seller owner ticks: revealed. Old and new messages read unmasked for the owner, masked for the viewer.
    const sellerTick = await share(seller.token, threadId);
    expect(sellerTick.json().data).toEqual({ revealed: true, number: buyer.phone });
    expectPlain((await messages(seller.token, threadId)).find((m) => m.id === before.id)!.text);
    expectMasked((await messages(sellerViewer.token, threadId)).find((m) => m.id === before.id)!.text);
    const after = await sendWatched(threadId, owner, viewer);
    expectPlain(after.owner.message.text);
    expectPlain(after.owner.row.lastMessage.text);
    expectMasked(after.viewer.message.text);
    expectMasked(after.viewer.row.lastMessage.text);
    expect((await detail(seller.token, threadId)).contact).toMatchObject({ revealed: true, theirs: true, number: buyer.phone });
    expect((await detail(sellerViewer.token, threadId)).contact).toMatchObject({ revealed: true, number: null, canTick: false });
    const lines = await db.select().from(chatMessages).where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.systemCode, 'contact_shared')));
    expect(lines).toHaveLength(1);

    // The deal is cancelled: the text stays unmasked.
    await db.update(deals).set({ status: 'cancelled' }).where(eq(deals.id, deal.dealId));
    expectPlain((await messages(seller.token, threadId)).find((m) => m.id === before.id)!.text);

    // Consents are append-only.
    await expect(db.update(contactShareConsents).set({ reason: 'number_removed' }).where(eq(contactShareConsents.threadId, threadId))).rejects.toThrow();

    // The seller adds a contact number (replacing the owner-phone fallback): the old number is withdrawn and stops
    // showing until a new tick; the text stays unmasked.
    const phone = uniqueTestPhone();
    const sent = await app.inject({ method: 'POST', url: '/businesses/me/contact-phone/otp/send', headers: auth(seller.token), payload: { phone: phone.slice(3) } });
    expect(sent.statusCode).toBe(200);
    const verified = await app.inject({
      method: 'POST', url: '/businesses/me/contact-phone/otp/verify', headers: auth(seller.token), payload: { code: sent.json().data.devCode },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().data.contactPhone).toBe(phone);
    const withdraws = await db
      .select()
      .from(contactShareConsents)
      .where(and(eq(contactShareConsents.businessId, seller.businessId), eq(contactShareConsents.kind, 'withdraw')));
    expect(withdraws).toHaveLength(1);
    expect(withdraws[0]).toMatchObject({ phoneShown: seller.phone, reason: 'number_replaced', threadId: null });
    expect((await detail(buyer.token, threadId)).contact).toMatchObject({ revealed: true, theirs: false, number: null });
    expectPlain((await messages(seller.token, threadId)).find((m) => m.id === before.id)!.text);
    // A new tick grants the new number.
    await share(seller.token, threadId);
    expect((await detail(buyer.token, threadId)).contact).toMatchObject({ theirs: true, number: phone });
  });
});

describe('who may tick', () => {
  it('on the owner-phone fallback only the owner ticks; a third business gets 404', async () => {
    const listing = await newListing();
    const threadId = await newThread(listing.id);
    await insertTestDeal({ listing, buyer, quantity: '1', pricePerUnitPaise: 10_000 });
    expect((await detail(buyerSales.token, threadId)).contact).toMatchObject({ canTick: false, ownerOnlyHint: true });
    const denied = await share(buyerSales.token, threadId);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('OWNER_CONSENT_REQUIRED');
    expect((await detail(buyer.token, threadId)).contact).toMatchObject({ canTick: true, ownerOnlyHint: false });

    const outsider = await share(third.token, threadId);
    expect(outsider.statusCode).toBe(404);
    expect(outsider.json().code).toBe('THREAD_NOT_FOUND');
  });

  it('refuses a non-owner on the contact-number routes', async () => {
    for (const [method, path, payload] of [
      ['POST', '/businesses/me/contact-phone/otp/send', { phone: '9876543210' }],
      ['POST', '/businesses/me/contact-phone/otp/verify', { code: '123456' }],
      ['DELETE', '/businesses/me/contact-phone', undefined],
    ] as const) {
      const res = await app.inject({ method, url: path, headers: auth(sellerSales.token), ...(payload ? { payload } : {}) });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('OWNER_ONLY');
    }
  });

  it('refuses a user who has not finished onboarding with ONBOARDING_INCOMPLETE', async () => {
    const signIn = await signInWithPhone(db, uniqueTestPhone());
    try {
      const token = signUserToken({ userId: signIn.user.id, businessId: null });
      for (const [method, path, payload] of [
        ['POST', '/businesses/me/contact-phone/otp/send', { phone: '9876543210' }],
        ['POST', '/businesses/me/contact-phone/otp/verify', { code: '123456' }],
        ['DELETE', '/businesses/me/contact-phone', undefined],
      ] as const) {
        const res = await app.inject({ method, url: path, headers: auth(token), ...(payload ? { payload } : {}) });
        expect(res.statusCode).toBe(409);
        expect(res.json().code).toBe('ONBOARDING_INCOMPLETE');
      }
    } finally {
      await deleteTestUsers([signIn.user.id]);
    }
  });
});

