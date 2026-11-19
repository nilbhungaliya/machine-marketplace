import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { setupSocketIO } from '../src/socket/setup.js';
import { viewingKey } from '../src/services/chat/viewing.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { addTestMember } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// L1-3: inbox, read, archive, your turn, viewing (F6 + F7 spec §5.3, §6.10, §13, P15).

let app: FastifyInstance;
let url: string;
let seller: TestSeller;
let buyer: TestBusinessUser;
let third: TestBusinessUser;
let sellerViewer: { userId: string; token: string };
const businessIds: string[] = [];
const sockets: Socket[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function newThread(): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'live', quantity: '5', priceModel: 'negotiable', pricePaise: 50_000,
  });
  const res = await app.inject({ method: 'POST', url: `/listings/${id}/enquiry`, headers: auth(buyer.token), payload: { quick: ['is_available'] } });
  return res.json().data.threadId;
}

const send = (token: string, threadId: string, text: string) =>
  app.inject({ method: 'POST', url: `/threads/${threadId}/messages`, headers: auth(token), payload: { clientMessageId: randomUUID(), text } });

async function inbox(token: string, query = '') {
  const res = await app.inject({ method: 'GET', url: `/threads${query}`, headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json().data as { items: Array<{ threadId: string; unread: number; yourTurn: boolean; archived: boolean; lastMessage: { text: string | null } | null }>; counts: { yourTurn: number } };
}

const rowOf = async (token: string, threadId: string, query = '') => (await inbox(token, query)).items.find((r) => r.threadId === threadId);

function client(token: string): Promise<Socket> {
  const socket = connect(`${url}/user`, { auth: { token }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
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
});

afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await app.redis?.del(viewingKey(buyer.userId), viewingKey(third.userId));
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras([seller]);
  await app.close();
});

describe('unread and read', () => {
  it("counts the other side's lines only, clears on read and never moves the read position back", async () => {
    const threadId = await newThread();
    expect((await rowOf(seller.token, threadId))!.unread).toBe(1);
    expect((await rowOf(buyer.token, threadId))!.unread).toBe(0);

    const reply = await send(seller.token, threadId, 'yes, available');
    const replySeq = Number(reply.json().data.seq);
    expect((await rowOf(seller.token, threadId))!.unread).toBe(1);
    expect((await rowOf(buyer.token, threadId))!.unread).toBe(1);

    const read = await app.inject({ method: 'POST', url: `/threads/${threadId}/read`, headers: auth(buyer.token), payload: { seq: replySeq } });
    expect(read.json().data).toEqual({ unread: 0 });
    expect((await rowOf(buyer.token, threadId))!.unread).toBe(0);

    await app.inject({ method: 'POST', url: `/threads/${threadId}/read`, headers: auth(buyer.token), payload: { seq: 1 } });
    expect((await rowOf(buyer.token, threadId))!.unread).toBe(0);
    const detail = await app.inject({ method: 'GET', url: `/threads/${threadId}`, headers: auth(buyer.token) });
    expect(Number(detail.json().data.lastReadSeq)).toBe(replySeq);
  });
});

describe('archive', () => {
  it("hides the thread for me only; the other side's next message brings it back", async () => {
    const threadId = await newThread();
    const archive = await app.inject({ method: 'PUT', url: `/threads/${threadId}/archive`, headers: auth(buyer.token) });
    expect(archive.statusCode).toBe(200);
    expect(await rowOf(buyer.token, threadId)).toBeUndefined();
    expect((await rowOf(buyer.token, threadId, '?archived=true'))!.archived).toBe(true);
    expect(await rowOf(seller.token, threadId)).toBeDefined();

    await send(buyer.token, threadId, 'my own line keeps it archived');
    expect(await rowOf(buyer.token, threadId)).toBeUndefined();
    await send(seller.token, threadId, 'reply');
    expect(await rowOf(buyer.token, threadId)).toBeDefined();
  });

  it('a viewer archives in its own inbox but still cannot presign or send', async () => {
    const threadId = await newThread();
    const archive = await app.inject({ method: 'PUT', url: `/threads/${threadId}/archive`, headers: auth(sellerViewer.token) });
    expect(archive.statusCode).toBe(200);
    expect(await rowOf(sellerViewer.token, threadId)).toBeUndefined();
    expect(await rowOf(seller.token, threadId)).toBeDefined();

    const presign = await app.inject({
      method: 'POST', url: `/threads/${threadId}/photos/presign`, headers: auth(sellerViewer.token), payload: { contentType: 'image/jpeg', contentLength: 100 },
    });
    expect(presign.statusCode).toBe(403);
    const sent = await send(sellerViewer.token, threadId, 'hello');
    expect(sent.statusCode).toBe(403);
    expect(sent.json().code).toBe('VIEWER_READ_ONLY');
  });
});

describe('your turn and previews', () => {
  it('follows the stored turn: an open enquiry is the seller’s turn until the seller replies', async () => {
    const threadId = await newThread();
    const before = await inbox(seller.token, '?filter=your_turn');
    expect(before.items.some((r) => r.threadId === threadId)).toBe(true);
    expect(before.counts.yourTurn).toBe(before.items.length);
    expect((await rowOf(buyer.token, threadId))!.yourTurn).toBe(false);

    await send(seller.token, threadId, 'Yes');
    const after = await inbox(seller.token, '?filter=your_turn');
    expect(after.items.some((r) => r.threadId === threadId)).toBe(false);
    expect(after.counts.yourTurn).toBe(before.counts.yourTurn - 1);
  });

  it("masks a phone number in the preview for the reader", async () => {
    const threadId = await newThread();
    await send(buyer.token, threadId, 'call me on +91 98765 43210');
    const row = await rowOf(seller.token, threadId);
    expect(row!.lastMessage!.text).not.toContain('98765');
    expect(row!.lastMessage!.text).toContain('••••');
  });
});

describe('thread:viewing', () => {
  it("sets nothing for another business's thread; sets the key for a party", async () => {
    const threadId = await newThread();
    const outsider = await client(third.token);
    const ack = await outsider.emitWithAck('thread:viewing', { threadId });
    expect(ack).toEqual({ ok: false });
    expect(await app.redis!.get(viewingKey(third.userId))).toBeNull();

    const party = await client(buyer.token);
    expect(await party.emitWithAck('thread:viewing', { threadId })).toEqual({ ok: true });
    expect(await app.redis!.get(viewingKey(buyer.userId))).toBe(threadId);
    expect(await party.emitWithAck('thread:viewing', { threadId: null })).toEqual({ ok: true });
    expect(await app.redis!.get(viewingKey(buyer.userId))).toBeNull();
  });
});
