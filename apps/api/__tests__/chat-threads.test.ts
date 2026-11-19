import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { appSettings, chatMessages } from '../src/db/schema.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestBrand, deleteTestBrands, type TestBrand } from './_helpers/test-catalog.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// L1-1: threads, enquiries, text messages (F6 + F7 spec §6.1–§6.4, §6.7).

let app: FastifyInstance;
let seller: TestSeller;
let buyer: TestBusinessUser;
let third: TestBusinessUser;
let brandA: TestBrand;
let brandB: TestBrand;
const businessIds: string[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function listing(opts: { fitBrand?: string } = {}): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: null,
    status: 'live',
    quantity: '10',
    priceModel: 'negotiable',
    pricePaise: 100_000,
    fitments: opts.fitBrand ? [{ brandId: opts.fitBrand }] : [],
  });
  return id;
}

function enquire(token: string, listingId: string, body: Record<string, unknown> = { quick: ['is_available'] }) {
  return app.inject({ method: 'POST', url: `/listings/${listingId}/enquiry`, headers: auth(token), payload: body });
}

function send(token: string, threadId: string, text: string, clientMessageId: string = randomUUID()) {
  return app.inject({ method: 'POST', url: `/threads/${threadId}/messages`, headers: auth(token), payload: { clientMessageId, text } });
}

beforeAll(async () => {
  // This file's app keeps the real message limit (30 / min per user, P8): no test here sends more than a few per user
  // except the limit test itself.
  const saved = process.env.GROUP_RATE_LIMIT_MAX;
  delete process.env.GROUP_RATE_LIMIT_MAX;
  app = await buildApp({ logger: false });
  process.env.GROUP_RATE_LIMIT_MAX = saved;
  seller = await createTestSeller();
  buyer = await createTestBusinessUser();
  third = await createTestBusinessUser();
  businessIds.push(seller.businessId, buyer.businessId, third.businessId);
  brandA = await createTestBrand();
  brandB = await createTestBrand();
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras([seller]);
  await deleteTestBrands([brandA.id, brandB.id]);
  await app.close();
});

describe('POST /listings/:id/enquiry', () => {
  it('two concurrent first enquiries make one thread with two cards', async () => {
    const listingId = await listing();
    const [a, b] = await Promise.all([enquire(buyer.token, listingId), enquire(buyer.token, listingId)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(a.json().data.threadId).toBe(b.json().data.threadId);
    const cards = await db.select().from(chatMessages).where(eq(chatMessages.threadId, a.json().data.threadId));
    expect(cards.filter((m) => m.kind === 'enquiry')).toHaveLength(2);
  });

  it('refuses a new thread over the daily limit, but not an enquiry in an existing thread', async () => {
    const limitBuyer = await createTestBusinessUser();
    businessIds.push(limitBuyer.businessId);
    await db
      .insert(appSettings)
      .values({ key: 'enquiry_new_per_day_unverified', value: 2 })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: 2 } });
    try {
      const first = await listing();
      expect((await enquire(limitBuyer.token, first)).statusCode).toBe(200);
      expect((await enquire(limitBuyer.token, await listing())).statusCode).toBe(200);
      const third = await enquire(limitBuyer.token, await listing());
      expect(third.statusCode).toBe(429);
      expect(third.json().code).toBe('ENQUIRY_LIMIT');
      expect((await enquire(limitBuyer.token, first)).statusCode).toBe(200);
    } finally {
      await db.delete(appSettings).where(eq(appSettings.key, 'enquiry_new_per_day_unverified'));
    }
  });

  it('resolves the machine and the verdict on the server; client names are ignored', async () => {
    const listingId = await listing({ fitBrand: brandA.id });
    const fits = await enquire(buyer.token, listingId, {
      quick: ['compatibility'],
      fit: { brandId: brandA.id, year: 2018, brandName: 'Made Up' },
    });
    expect(fits.statusCode).toBe(200);
    expect(fits.json().data.message.enquiry.machine).toMatchObject({ brandId: brandA.id, brandName: brandA.name, year: 2018, verdict: 'fits' });
    const other = await enquire(buyer.token, listingId, { quick: ['compatibility'], fit: { brandId: brandB.id } });
    expect(other.json().data.message.enquiry.machine).toMatchObject({ brandName: brandB.name, verdict: 'not_listed' });
  });
});

describe('thread reads and messages', () => {
  it('answers 404 to a third business on detail, messages and send', async () => {
    const { threadId } = (await enquire(buyer.token, await listing())).json().data;
    for (const res of [
      await app.inject({ method: 'GET', url: `/threads/${threadId}`, headers: auth(third.token) }),
      await app.inject({ method: 'GET', url: `/threads/${threadId}/messages`, headers: auth(third.token) }),
      await send(third.token, threadId, 'hello'),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('THREAD_NOT_FOUND');
    }
    const detail = await app.inject({ method: 'GET', url: `/threads/${threadId}`, headers: auth(seller.token) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({ side: 'seller', enquiryStatus: 'open', canWrite: true, blockState: 'none' });
  });

  it('a retried clientMessageId returns the stored message', async () => {
    const { threadId } = (await enquire(buyer.token, await listing())).json().data;
    const id = randomUUID();
    const a = await send(buyer.token, threadId, 'first try', id);
    const b = await send(buyer.token, threadId, 'first try', id);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(b.json().data.id).toBe(a.json().data.id);
    const rows = await db.select().from(chatMessages).where(eq(chatMessages.clientMessageId, id));
    expect(rows).toHaveLength(1);
  });

  it('shows the scam warning to the other side only', async () => {
    const { threadId } = (await enquire(buyer.token, await listing())).json().data;
    const sent = await send(seller.token, threadId, 'Please pay the advance payment first');
    expect(sent.json().data.scamWarning).toBe(false);
    const [buyerView] = (await app.inject({ method: 'GET', url: `/threads/${threadId}/messages`, headers: auth(buyer.token) })).json().data;
    expect(buyerView).toMatchObject({ kind: 'text', scamWarning: true, isMine: false });
    const [sellerView] = (await app.inject({ method: 'GET', url: `/threads/${threadId}/messages`, headers: auth(seller.token) })).json().data;
    expect(sellerView).toMatchObject({ scamWarning: false, isMine: true });
  });

  it('refuses an empty message', async () => {
    const { threadId } = (await enquire(buyer.token, await listing())).json().data;
    const res = await send(buyer.token, threadId, '   ');
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MESSAGE_EMPTY');
  });
});

describe('message rate limit', () => {
  it('answers 429 to the 31st message in a minute', async () => {
    const limitBuyer = await createTestBusinessUser();
    businessIds.push(limitBuyer.businessId);
    const { threadId } = (await enquire(limitBuyer.token, await listing())).json().data;
    for (let i = 0; i < 30; i++) expect((await send(limitBuyer.token, threadId, 'hi')).statusCode).toBe(200);
    const over = await send(limitBuyer.token, threadId, 'hi');
    expect(over.statusCode).toBe(429);
    expect(over.json().code).toBe('RATE_LIMITED');
  });
});

