import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { businessBlocks, chatThreads, dealEvents, deals, listings, stockHolds } from '../src/db/schema.js';
import { addTestMember, assertHeldInvariant, insertTestDeal } from './_helpers/test-deals.js';
import { call, createOfferWorld, extraBuyer, newKey, offerListing, offerRow, setTestSettings, type OfferWorld } from './_helpers/test-offers.js';

// L2-3: accept → deal + hold (F6 + F7 spec §7.6, §8.1; Review focus 3).

let w: OfferWorld;
let restore: () => Promise<void>;

const post = (token: string, url: string, body: object = {}, key?: string) => call(w.app, token, 'POST', url, body, key);
const accept = (id: string, key?: string, token = w.seller.token) => post(token, `/offers/${id}/accept`, {}, key);

async function sendOffer(buyerToken: string, listingId: string, quantity: string, price = 90_000): Promise<string> {
  const res = await post(buyerToken, `/listings/${listingId}/offers`, { kind: 'offer', pricePerUnitPaise: price, quantity });
  expect(res.statusCode).toBe(200);
  return res.json().data.offer.id;
}
const dealsOf = (listingId: string) => db.select().from(deals).where(eq(deals.listingId, listingId));
async function listingRow(id: string) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row!;
}

beforeAll(async () => {
  w = await createOfferWorld(2);
  restore = await setTestSettings({ offer_open_limit_unverified: 50, enquiry_new_per_day_unverified: 100 });
});

afterAll(async () => {
  await restore?.();
  await w?.cleanup();
});

describe('accept', () => {
  it('makes a deal with the offer’s terms and holds the quantity (2.5 units, total half up)', async () => {
    const listingId = await offerListing(w, { unitId: w.decimalUnitId, quantity: '10', pricePaise: 40_000 });
    const offerId = await sendOffer(w.buyers[0]!.token, listingId, '2.5', 33_333);
    // A price edit after the offer doesn't move the deal.
    await db.update(listings).set({ pricePaise: 39_000 }).where(eq(listings.id, listingId));

    const res = await accept(offerId);
    expect(res.statusCode).toBe(200);
    const { dealId, offer } = res.json().data;
    expect(offer.status).toBe('accepted');
    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(deal).toMatchObject({ status: 'agreed', pricePerUnitPaise: 33_333, quantity: '2.500', totalPaise: 83_333n, offerId });
    expect(deal!.ref).toBeGreaterThanOrEqual(500_001);
    expect((await offerRow(offerId)).totalPaise).toBe(83_333n);
    const [hold] = await db.select().from(stockHolds).where(eq(stockHolds.dealId, dealId));
    expect(hold).toMatchObject({ status: 'active', quantity: '2.500' });
    expect((await listingRow(listingId)).heldQuantity).toBe('2.500');
    expect(await db.select().from(dealEvents).where(eq(dealEvents.dealId, dealId))).toHaveLength(1);
    const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, offer.threadId));
    expect(thread!.dealCount).toBe(1);
    await assertHeldInvariant(listingId);
  });

  it('serialises two accepts for the last units: one deal, the other offer a backup, the listing reserved', async () => {
    const listingId = await offerListing(w, { quantity: '3' });
    const a = await sendOffer(w.buyers[0]!.token, listingId, '3');
    const b = await sendOffer(w.buyers[1]!.token, listingId, '3');
    const results = await Promise.all([accept(a), accept(b)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const lost = results.find((r) => r.statusCode === 409)!;
    expect(lost.json()).toMatchObject({ code: 'QUANTITY_NOT_AVAILABLE', details: { available: '0' } });
    expect(await dealsOf(listingId)).toHaveLength(1);
    const loser = results[0]!.statusCode === 409 ? a : b;
    expect((await offerRow(loser)).status).toBe('backup');
    expect((await listingRow(listingId)).status).toBe('reserved');
    await assertHeldInvariant(listingId);
  });

  it('accept racing withdraw: exactly one wins and the state matches it', async () => {
    const listingId = await offerListing(w);
    const id = await sendOffer(w.buyers[0]!.token, listingId, '1');
    const [acc, wd] = await Promise.all([accept(id), post(w.buyers[0]!.token, `/offers/${id}/withdraw`)]);
    expect([acc.statusCode, wd.statusCode].filter((s) => s === 200)).toHaveLength(1);
    const status = (await offerRow(id)).status;
    if (acc.statusCode === 200) {
      expect(status).toBe('accepted');
      expect(await dealsOf(listingId)).toHaveLength(1);
    } else {
      expect(status).toBe('withdrawn');
      expect(await dealsOf(listingId)).toHaveLength(0);
    }
    await assertHeldInvariant(listingId);
  });

  it('refuses an accept after the listing was paused (its offers closed)', async () => {
    const listingId = await offerListing(w);
    const id = await sendOffer(w.buyers[0]!.token, listingId, '1');
    const pause = await post(w.seller.token, `/listings/${listingId}/actions`, { action: 'pause' });
    expect(pause.statusCode).toBe(200);
    const res = await accept(id);
    expect([res.statusCode, res.json().code]).toEqual([409, 'OFFER_NOT_OPEN']);
    expect(await dealsOf(listingId)).toHaveLength(0);
    expect(await offerRow(id)).toMatchObject({ status: 'closed', closeReason: 'listing_unavailable' });
  });

  it('a retried Idempotency-Key replays the same deal', async () => {
    const listingId = await offerListing(w);
    const id = await sendOffer(w.buyers[0]!.token, listingId, '1');
    const key = newKey();
    const first = await accept(id, key);
    const retry = await accept(id, key);
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(retry.json().data.dealId).toBe(first.json().data.dealId);
    expect(await dealsOf(listingId)).toHaveLength(1);
  });

  it('too little stock commits the move to backup and answers 409; a retry replays the stored 409', async () => {
    const listingId = await offerListing(w, { quantity: '3' });
    const id = await sendOffer(w.buyers[0]!.token, listingId, '2');
    // Another deal takes 2 without running reconcile (a fixture), so this pending offer no longer fits.
    const other = await extraBuyer();
    await insertTestDeal({ listing: { id: listingId }, buyer: other, quantity: '2', pricePerUnitPaise: 100_000 });
    const key = newKey();
    const res = await accept(id, key);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'QUANTITY_NOT_AVAILABLE', details: { available: '1' } });
    const row = await offerRow(id);
    expect(row).toMatchObject({ status: 'backup', expiresAt: null });
    expect(row.backupSince).not.toBeNull();
    const retry = await accept(id, key);
    expect(retry.statusCode).toBe(409);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(retry.json().code).toBe('QUANTITY_NOT_AVAILABLE');
    expect(await dealsOf(listingId)).toHaveLength(1);
    await assertHeldInvariant(listingId);
  });

  it('refuses a viewer (403) and a third business (404)', async () => {
    const listingId = await offerListing(w);
    const id = await sendOffer(w.buyers[0]!.token, listingId, '1');
    const viewer = await addTestMember(w.seller.businessId, 'viewer');
    expect((await accept(id, undefined, viewer.token)).json().code).toBe('VIEWER_READ_ONLY');
    const outsider = await extraBuyer();
    const res = await accept(id, undefined, outsider.token);
    expect([res.statusCode, res.json().code]).toEqual([404, 'OFFER_NOT_FOUND']);
  });

  // Final review: a block that missed this thread (it raced the offer) is caught under the listing lock.
  it('refuses an accept between a blocked pair (403) and closes the chain as blocked', async () => {
    const listingId = await offerListing(w);
    const buyer = await extraBuyer();
    const id = await sendOffer(buyer.token, listingId, '1');
    await db.insert(businessBlocks).values({ blockerBusinessId: w.seller.businessId, blockedBusinessId: buyer.businessId, createdByUserId: w.seller.userId });
    const res = await accept(id);
    expect([res.statusCode, res.json().code]).toEqual([403, 'BUSINESS_BLOCKED']);
    expect(await offerRow(id)).toMatchObject({ status: 'closed', closeReason: 'blocked' });
    expect(await dealsOf(listingId)).toHaveLength(0);
  });

  // Final review: `setMyLocation` locks the seller business, then its listings; an accept holds the listing and inserts
  // rows referencing that business (KEY SHARE). The business lock is FOR NO KEY UPDATE, so neither waits on the other
  // in a cycle (40P01 before).
  it('a location change racing an accept on that business’s listing: both settle, no deadlock', async () => {
    for (let i = 0; i < 3; i++) {
      const listingId = await offerListing(w);
      const id = await sendOffer(w.buyers[0]!.token, listingId, '1');
      const location = { pincode: '990011', city: 'Surat', state: 'Gujarat', industrialAreaOther: 'Test Estate', lat: 21.2 + i / 100, lng: 72.8 };
      const [put, acc] = await Promise.all([
        call(w.app, w.seller.token, 'PUT', '/businesses/me/location', location),
        accept(id),
      ]);
      expect(put.statusCode, put.body).toBe(200);
      expect(acc.statusCode, acc.body).toBe(200);
      await assertHeldInvariant(listingId);
    }
  });
});
