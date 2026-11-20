import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { notifications } from '../src/db/schema.js';
import { addTestMember } from './_helpers/test-deals.js';
import { call, createOfferWorld, offerListing, setTestSettings, type OfferWorld } from './_helpers/test-offers.js';
import { insertTestMatch, insertTestPartRequest, insertTestReply, type TestPartRequestRow } from './_helpers/test-part-requests.js';

// A3-3: the fulfilment prompt in F6 accept (F8 spec §9.4, review Q2): the buyer business is asked to mark a request
// fulfilled when the deal's listing was a delivered reply or a match on it; accept never waits on an F8 request lock.

let w: OfferWorld;
let restore: () => Promise<void>;

const post = (token: string, url: string, body: object = {}) => call(w.app, token, 'POST', url, body);

async function sendOffer(listingId: string, price = 90_000): Promise<string> {
  const res = await post(w.buyers[0]!.token, `/listings/${listingId}/offers`, { kind: 'offer', pricePerUnitPaise: price, quantity: '1' });
  expect(res.statusCode).toBe(200);
  return res.json().data.offer.id;
}

async function acceptBySeller(offerId: string): Promise<string> {
  const res = await post(w.seller.token, `/offers/${offerId}/accept`);
  expect(res.statusCode).toBe(200);
  return res.json().data.dealId;
}

const request = (status: 'active' | 'closed' = 'active'): Promise<TestPartRequestRow> =>
  insertTestPartRequest({
    businessId: w.buyers[0]!.businessId, userId: w.buyers[0]!.userId, categoryId: w.catalog.motorsGroupId, unitId: w.catalog.unitId, status,
  });

const reply = (requestId: string, listingId: string) =>
  insertTestReply({ partRequestId: requestId, sellerBusinessId: w.seller.businessId, listingId, userId: w.seller.userId });

const promptsOf = (requestId: string) =>
  db
    .select()
    .from(notifications)
    .where(and(eq(notifications.partRequestId, requestId), eq(notifications.type, 'part_request_fulfil_prompt')));

beforeAll(async () => {
  w = await createOfferWorld(1);
  restore = await setTestSettings({ offer_open_limit_unverified: 50, enquiry_new_per_day_unverified: 100 });
  await addTestMember(w.buyers[0]!.businessId, 'viewer');
});

afterAll(async () => {
  await restore?.();
  await w?.cleanup();
});

describe('notifyFulfilPrompts (accept)', () => {
  it('a delivered-reply listing: one prompt per buyer member, with the deal, seller name and masked title', async () => {
    const listingId = await offerListing(w);
    const req = await insertTestPartRequest({
      businessId: w.buyers[0]!.businessId, userId: w.buyers[0]!.userId, categoryId: w.catalog.motorsGroupId,
      unitId: w.catalog.unitId, name: 'Motor call 98765 43210',
    });
    await reply(req.id, listingId);
    const dealId = await acceptBySeller(await sendOffer(listingId));

    const rows = await promptsOf(req.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.businessId === w.buyers[0]!.businessId && r.dealId === dealId)).toBe(true);
    expect(rows[0]!.dedupeKey).toBe(`part_request_fulfil_prompt:${req.id}:${dealId}`);
    expect(rows[0]!.params).toMatchObject({ businessName: expect.stringContaining('Test') });
    expect(JSON.stringify(rows[0]!.params)).not.toMatch(/98765|43210/);
  });

  it('a buyer member accepting the seller’s counter still prompts the buyer business', async () => {
    const listingId = await offerListing(w);
    const req = await request();
    await reply(req.id, listingId);
    const first = await sendOffer(listingId);
    const counter = await post(w.seller.token, `/offers/${first}/counter`, { pricePerUnitPaise: 95_000, quantity: '1' });
    expect(counter.statusCode).toBe(200);
    const accepted = await post(w.buyers[0]!.token, `/offers/${counter.json().data.id}/accept`);
    expect(accepted.statusCode).toBe(200);
    expect(await promptsOf(req.id)).toHaveLength(2);
  });

  it('a match listing prompts; an unrelated listing and a closed request do not', async () => {
    const matched = await offerListing(w);
    const unrelated = await offerListing(w);
    const viaMatch = await request();
    await insertTestMatch({ partRequestId: viaMatch.id, listingId: matched, sellerBusinessId: w.seller.businessId });
    const closed = await request('closed');
    await reply(closed.id, unrelated);
    const elsewhere = await request();

    await acceptBySeller(await sendOffer(matched));
    await acceptBySeller(await sendOffer(unrelated));
    expect(await promptsOf(viaMatch.id)).toHaveLength(2);
    expect(await promptsOf(closed.id)).toHaveLength(0);
    expect(await promptsOf(elsewhere.id)).toHaveLength(0);
  });

  it('accept completes while a job transaction holds the request FOR NO KEY UPDATE', async () => {
    const listingId = await offerListing(w);
    const req = await request();
    await reply(req.id, listingId);
    const offerId = await sendOffer(listingId);

    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const held = new Promise<void>((r) => (release = r));
    const job = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM part_requests WHERE id = ${req.id} FOR NO KEY UPDATE`);
      locked();
      await held;
    });
    await isLocked;
    try {
      const res = await Promise.race([
        post(w.seller.token, `/offers/${offerId}/accept`),
        new Promise<'waited'>((r) => setTimeout(() => r('waited'), 5_000)),
      ]);
      expect(res).not.toBe('waited');
      expect((res as Awaited<ReturnType<typeof post>>).statusCode).toBe(200);
    } finally {
      release();
      await job;
    }
    expect(await promptsOf(req.id)).toHaveLength(2);
  });
});
