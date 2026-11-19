import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { chatThreads, offers } from '../src/db/schema.js';
import { loadOfferView } from '../src/services/offers/offer-view.js';
import { insertTestOffer, insertTestThread } from './_helpers/test-deals.js';
import { call, createOfferWorld, offerListing, offerRow, setTestSettings, type OfferWorld } from './_helpers/test-offers.js';

// L2-2: counter, reject, withdraw, reconfirm (F6 + F7 spec §7.4, §7.5).

let w: OfferWorld;
let restore: () => Promise<void>;

const post = (token: string, url: string, body: object = {}) => call(w.app, token, 'POST', url, body);
const buyerToken = () => w.buyers[0]!.token;
const sellerToken = () => w.seller.token;

async function open(price = 50_000, extra: object = {}): Promise<string> {
  const listingId = await offerListing(w, extra);
  const res = await post(buyerToken(), `/listings/${listingId}/offers`, { kind: 'offer', pricePerUnitPaise: price, quantity: '1' });
  expect(res.statusCode).toBe(200);
  return res.json().data.offer.id;
}
const counter = (token: string, id: string, price: number, quantity = '1') =>
  post(token, `/offers/${id}/counter`, { pricePerUnitPaise: price, quantity });

async function threadOf(offerId: string) {
  const row = await offerRow(offerId);
  const [t] = await db.select().from(chatThreads).where(eq(chatThreads.id, row.threadId));
  return t!;
}

beforeAll(async () => {
  w = await createOfferWorld(1);
  restore = await setTestSettings({ offer_open_limit_unverified: 50, enquiry_new_per_day_unverified: 100 });
});

afterAll(async () => {
  await restore?.();
  await w?.cleanup();
});

describe('counter', () => {
  it('each side’s counter swaps the turn and adds a round; the old row is countered', async () => {
    const first = await open(50_000);
    const s = await counter(sellerToken(), first, 90_000);
    expect(s.statusCode).toBe(200);
    expect(s.json().data).toMatchObject({ round: 1, senderSide: 'seller', turn: 'buyer', status: 'pending', previousOfferId: first });
    expect((await offerRow(first)).status).toBe('countered');
    expect((await threadOf(first)).firstSellerReplyAt).not.toBeNull();

    const b = await counter(buyerToken(), s.json().data.id, 60_000);
    expect(b.statusCode).toBe(200);
    expect(b.json().data).toMatchObject({ round: 2, senderSide: 'buyer', turn: 'seller', negotiationId: first });
    const t = await threadOf(first);
    expect([t.buyerTurn, t.sellerTurn]).toEqual([false, true]);
  });

  it('keeps counters between the two latest prices (§7.4)', async () => {
    const first = await open(50_000);
    // Seller: B < c ≤ S (S = asking 100 000).
    const equalB = await counter(sellerToken(), first, 50_000);
    expect([equalB.statusCode, equalB.json().code, equalB.json().details]).toEqual([400, 'COUNTER_OUT_OF_BOUNDS', { min: 50_001, max: 100_000 }]);
    // Equal to its own latest (the asking price) only with a new quantity.
    const same = await counter(sellerToken(), first, 100_000, '1');
    expect([same.statusCode, same.json().code]).toEqual([400, 'COUNTER_UNCHANGED']);
    const newQty = await counter(sellerToken(), first, 100_000, '2');
    expect(newQty.statusCode).toBe(200);
    // Buyer: B ≤ c < S.
    const tooHigh = await counter(buyerToken(), newQty.json().data.id, 100_000, '2');
    expect(tooHigh.json()).toMatchObject({ code: 'COUNTER_OUT_OF_BOUNDS', details: { min: 50_000, max: 99_999 } });
  });

  it('lets the buyer answer a quote anywhere from 1 paisa to just under it', async () => {
    const listingId = await offerListing(w, { priceModel: 'on_request', pricePaise: null });
    const buyer = w.buyers[0]!;
    const t = await insertTestThread({ listingId, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    const quote = await post(sellerToken(), `/threads/${t.id}/quote`, { pricePerUnitPaise: 70_000, quantity: '1' });
    const at = await counter(buyerToken(), quote.json().data.id, 70_000);
    expect(at.json()).toMatchObject({ code: 'COUNTER_OUT_OF_BOUNDS', details: { min: 1, max: 69_999 } });
    const low = await counter(buyerToken(), quote.json().data.id, 1);
    expect(low.statusCode).toBe(200);
    // The next one (seller's): 1 < c ≤ 70 000; the buyer could also have gone to S − 1.
    expect(low.json().data.bounds).toEqual({ minPaise: 2, maxPaise: 70_000 });
  });

  it('stops counters after the 5th: accept or reject only', async () => {
    let id = await open(50_000);
    const prices = [90_000, 55_000, 85_000, 60_000, 80_000];
    for (const [i, price] of prices.entries()) {
      const res = await counter(i % 2 === 0 ? sellerToken() : buyerToken(), id, price);
      expect(res.statusCode).toBe(200);
      id = res.json().data.id;
    }
    const row = await offerRow(id);
    expect(row.round).toBe(5);
    const sixth = await counter(buyerToken(), id, 70_000);
    expect([sixth.statusCode, sixth.json().code]).toEqual([409, 'COUNTER_LIMIT']);
    const view = await loadOfferView(db, row, { side: 'buyer', memberRole: 'owner' }, await threadOf(id));
    expect(view.actions).toEqual(['accept', 'reject']);
    expect(view.bounds).toBeNull();
  });

  it('refuses a counter on a buy-now chain', async () => {
    const listingId = await offerListing(w, { priceModel: 'fixed' });
    const res = await post(buyerToken(), `/listings/${listingId}/offers`, { kind: 'buy_now', quantity: '1' });
    const c = await counter(sellerToken(), res.json().data.offer.id, 90_000);
    expect([c.statusCode, c.json().code]).toEqual([409, 'COUNTER_NOT_ALLOWED']);
  });

  it('refuses the sender accepting or countering its own row', async () => {
    const id = await open(50_000);
    expect((await post(buyerToken(), `/offers/${id}/accept`)).json().code).toBe('NOT_YOUR_TURN');
    expect((await counter(buyerToken(), id, 60_000)).json().code).toBe('NOT_YOUR_TURN');
  });

  it('refuses an expired row by the database clock', async () => {
    const id = await open(50_000);
    await db.update(offers).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(offers.id, id));
    const res = await post(sellerToken(), `/offers/${id}/accept`);
    expect([res.statusCode, res.json().code]).toEqual([409, 'OFFER_EXPIRED']);
  });
});

describe('reject, withdraw, reconfirm', () => {
  it('reject ends the chain, then a new offer is allowed', async () => {
    const id = await open(50_000);
    const res = await post(sellerToken(), `/offers/${id}/reject`, { note: 'Too low' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'rejected', rejectNote: 'Too low', actions: [] });
    const row = await offerRow(id);
    const again = await post(buyerToken(), `/listings/${row.listingId}/offers`, { kind: 'offer', pricePerUnitPaise: 70_000, quantity: '1' });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.offer.round).toBe(0);
  });

  it('withdraw: the sender before an answer only', async () => {
    const id = await open(50_000);
    expect((await post(sellerToken(), `/offers/${id}/withdraw`)).json().code).toBe('NOT_YOUR_TURN');
    const answered = await counter(sellerToken(), id, 90_000);
    const late = await post(buyerToken(), `/offers/${id}/withdraw`);
    expect([late.statusCode, late.json().code]).toEqual([409, 'OFFER_NOT_OPEN']);
    // The seller may withdraw its own counter before the buyer answers.
    const own = await post(sellerToken(), `/offers/${answered.json().data.id}/withdraw`);
    expect(own.json().data.status).toBe('withdrawn');
  });

  it('reconfirm: the seller only, on a row that needs it', async () => {
    const listingId = await offerListing(w, { priceModel: 'on_request', pricePaise: null });
    const buyer = w.buyers[0]!;
    const t = await insertTestThread({ listingId, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    const row = await insertTestOffer({ threadId: t.id, kind: 'quote', pricePerUnitPaise: 70_000, quantity: '1', turn: 'seller', needsReconfirm: true });
    expect((await post(buyerToken(), `/offers/${row.id}/reconfirm`)).json().code).toBe('NOT_YOUR_TURN');
    expect((await post(buyerToken(), `/offers/${row.id}/accept`)).json().code).toBe('OFFER_NEEDS_RECONFIRM');
    const ok = await post(sellerToken(), `/offers/${row.id}/reconfirm`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ turn: 'buyer', needsReconfirm: false });
    expect((await post(sellerToken(), `/offers/${row.id}/reconfirm`)).json().code).toBe('NOT_YOUR_TURN');
  });
});
