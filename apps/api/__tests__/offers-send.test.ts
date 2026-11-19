import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { chatThreads } from '../src/db/schema.js';
import { loadOfferView } from '../src/services/offers/offer-view.js';
import { addTestMember, insertTestOffer, insertTestThread } from './_helpers/test-deals.js';
import { call, createOfferWorld, extraBuyer, offerListing, offerRow, setTestSettings, type OfferWorld } from './_helpers/test-offers.js';

// L2-1: send an offer or buy now, quotes, limits (F6 + F7 spec §7.1–§7.3, §7.8).

let w: OfferWorld;
let restore: () => Promise<void>;

const post = (token: string, url: string, body: object) => call(w.app, token, 'POST', url, body);
const offer = (token: string, listingId: string, body: object) => post(token, `/listings/${listingId}/offers`, body);

beforeAll(async () => {
  w = await createOfferWorld(3);
  restore = await setTestSettings({ offer_open_limit_unverified: 3, enquiry_new_per_day_unverified: 100 });
});

afterAll(async () => {
  await restore?.();
  await w?.cleanup();
});

describe('sending an offer or buy now', () => {
  it('refuses an offer above the asking price', async () => {
    const id = await offerListing(w);
    const res = await offer(w.buyers[0]!.token, id, { kind: 'offer', pricePerUnitPaise: 100_001, quantity: '1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('PRICE_ABOVE_ASKING');
  });

  it('stores the asking price for buy now whatever the body says', async () => {
    const id = await offerListing(w, { priceModel: 'fixed', pricePaise: 250_000 });
    const res = await offer(w.buyers[0]!.token, id, { kind: 'buy_now', pricePerUnitPaise: 1, quantity: '2' });
    expect(res.statusCode).toBe(200);
    const view = res.json().data.offer;
    expect(view.pricePerUnitPaise).toBe(250_000);
    expect(view.totalPaise).toBe('500000');
    expect(view.turn).toBe('seller');
    expect(view.bounds).toBeNull();
    expect((await offerRow(view.id)).pricePerUnitPaise).toBe(250_000);
  });

  it('refuses offers on rentals', async () => {
    const id = await offerListing(w, { kind: 'machine_rental', categoryId: w.catalog.machineTypeId, priceModel: null, pricePaise: null });
    const res = await offer(w.buyers[0]!.token, id, { kind: 'offer', pricePerUnitPaise: 100, quantity: '1' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OFFERS_NOT_FOR_RENTALS');
  });

  it('refuses a button that does not fit the price model', async () => {
    const negotiable = await offerListing(w);
    const fixed = await offerListing(w, { priceModel: 'fixed' });
    const a = await offer(w.buyers[0]!.token, negotiable, { kind: 'buy_now', quantity: '1' });
    const b = await offer(w.buyers[0]!.token, fixed, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '1' });
    expect([a.statusCode, a.json().code]).toEqual([409, 'PRICE_MODEL_MISMATCH']);
    expect([b.statusCode, b.json().code]).toEqual([409, 'PRICE_MODEL_MISMATCH']);
  });

  it('allows one open negotiation per thread', async () => {
    const id = await offerListing(w);
    const first = await offer(w.buyers[1]!.token, id, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '1' });
    expect(first.statusCode).toBe(200);
    const second = await offer(w.buyers[1]!.token, id, { kind: 'offer', pricePerUnitPaise: 80_000, quantity: '1' });
    expect([second.statusCode, second.json().code]).toEqual([409, 'NEGOTIATION_OPEN']);
  });

  it('checks the quantity: minimum (with the whole remainder allowed), available, unit decimals', async () => {
    const minFour = await offerListing(w, { minOrderQty: '4' });
    const below = await offer(w.buyers[0]!.token, minFour, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '2' });
    expect([below.statusCode, below.json().code]).toEqual([400, 'QUANTITY_BELOW_MINIMUM']);
    const above = await offer(w.buyers[0]!.token, minFour, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '6' });
    expect([above.statusCode, above.json().code]).toEqual([409, 'QUANTITY_NOT_AVAILABLE']);

    // 3 left of a minimum of 4: exactly the whole remainder is allowed, less is not.
    const remainder = await offerListing(w, { quantity: '3', minOrderQty: '4' });
    const less = await offer(w.buyers[0]!.token, remainder, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '2' });
    expect(less.json().code).toBe('QUANTITY_BELOW_MINIMUM');
    const whole = await offer(w.buyers[0]!.token, remainder, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '3' });
    expect(whole.statusCode).toBe(200);

    const decimals = await offerListing(w);
    const frac = await offer(w.buyers[0]!.token, decimals, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '1.5' });
    expect([frac.statusCode, frac.json().code]).toEqual([400, 'QUANTITY_DECIMALS']);
  });

  it('refuses a viewer', async () => {
    const id = await offerListing(w);
    const viewer = await addTestMember(w.buyers[0]!.businessId, 'viewer');
    const res = await offer(viewer.token, id, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '1' });
    expect([res.statusCode, res.json().code]).toEqual([403, 'VIEWER_READ_ONLY']);
  });

  it('masks a number in the note for the other side (and the sender) until the contact unlocks', async () => {
    const id = await offerListing(w);
    const res = await offer(w.buyers[2]!.token, id, { kind: 'offer', pricePerUnitPaise: 95_000, quantity: '1', note: 'Call me on 98765 43210' });
    expect(res.statusCode).toBe(200);
    const view = res.json().data.offer;
    expect(view.note).not.toContain('98765');
    const row = await offerRow(view.id);
    expect(row.note).toContain('98765 43210');
    const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, row.threadId));
    const sellerView = await loadOfferView(db, row, { side: 'seller', memberRole: 'owner' }, thread!);
    expect(sellerView.note).not.toContain('98765');
    expect(sellerView.actions).toEqual(['accept', 'counter', 'reject']);
    // Unlocked: the owner reads it as written; a viewer never does.
    const unlocked = { ...thread!, contactUnlockedAt: new Date() };
    expect((await loadOfferView(db, row, { side: 'seller', memberRole: 'owner' }, unlocked)).note).toContain('98765 43210');
    expect((await loadOfferView(db, row, { side: 'seller', memberRole: 'viewer' }, unlocked)).note).not.toContain('98765');
  });
});

describe('quotes', () => {
  it('refuses a quote on a negotiable listing; sends one on price on request', async () => {
    const buyer = w.buyers[0]!;
    const negotiable = await offerListing(w);
    const t1 = await insertTestThread({ listingId: negotiable, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    const refused = await post(w.seller.token, `/threads/${t1.id}/quote`, { pricePerUnitPaise: 90_000, quantity: '1' });
    expect([refused.statusCode, refused.json().code]).toEqual([409, 'QUOTE_NOT_ALLOWED']);

    const onRequest = await offerListing(w, { priceModel: 'on_request', pricePaise: null });
    const t2 = await insertTestThread({ listingId: onRequest, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    const quote = await post(w.seller.token, `/threads/${t2.id}/quote`, { pricePerUnitPaise: 70_000, quantity: '2' });
    expect(quote.statusCode).toBe(200);
    const view = quote.json().data;
    expect(view).toMatchObject({ kind: 'quote', senderSide: 'seller', turn: 'buyer', askingPricePaise: null, isMine: true });
    const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, t2.id));
    expect(thread!.firstSellerReplyAt).not.toBeNull();
    // The buyer may go anywhere from 1 paisa to just under the quote (§7.4).
    const buyerView = await loadOfferView(db, await offerRow(view.id), { side: 'buyer', memberRole: 'owner' }, thread!);
    expect(buyerView.bounds).toEqual({ minPaise: 1, maxPaise: 69_999 });
  });
});

describe('open-offer limit (§7.8)', () => {
  it('counts buyer-started negotiations only: not quotes, not backups, a counter not twice', async () => {
    const buyer = await extraBuyer();
    const send = (listingId: string, price = 90_000) => offer(buyer.token, listingId, { kind: 'offer', pricePerUnitPaise: price, quantity: '1' });

    // 1: a pending offer.
    expect((await send(await offerListing(w))).statusCode).toBe(200);
    // 2: an offer the seller countered (one negotiation, its latest row the seller's).
    const countered = await send(await offerListing(w));
    const counter = await post(w.seller.token, `/offers/${countered.json().data.offer.id}/counter`, { pricePerUnitPaise: 95_000, quantity: '1' });
    expect(counter.statusCode).toBe(200);
    // A quote in flight: not counted.
    const onRequest = await offerListing(w, { priceModel: 'on_request', pricePaise: null });
    const qt = await insertTestThread({ listingId: onRequest, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    expect((await post(w.seller.token, `/threads/${qt.id}/quote`, { pricePerUnitPaise: 70_000, quantity: '1' })).statusCode).toBe(200);
    // A backup: not counted.
    const bl = await offerListing(w);
    const bt = await insertTestThread({ listingId: bl, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    await insertTestOffer({ threadId: bt.id, status: 'backup', pricePerUnitPaise: 90_000, quantity: '1' });

    const options = await call(w.app, buyer.token, 'GET', '/offers/options');
    expect(options.json().data).toMatchObject({ openLimit: 3, openCount: 2, validityHours: [24, 48, 168], defaultValidityHours: 48, maxCounterRounds: 5 });

    // 3: allowed; the 4th is refused.
    expect((await send(await offerListing(w))).statusCode).toBe(200);
    const fourth = await send(await offerListing(w));
    expect([fourth.statusCode, fourth.json().code, fourth.json().details]).toEqual([409, 'OFFER_LIMIT_REACHED', { limit: 3 }]);

    // A counter at the limit is not a new negotiation.
    const back = await post(buyer.token, `/offers/${counter.json().data.id}/counter`, { pricePerUnitPaise: 92_000, quantity: '1' });
    expect(back.statusCode).toBe(200);
  });

  it('serialises two first offers at the limit on the buyer business: one 200, one 409', async () => {
    const buyer = await extraBuyer();
    for (let i = 0; i < 2; i++) {
      const res = await offer(buyer.token, await offerListing(w), { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '1' });
      expect(res.statusCode).toBe(200);
    }
    const [a, b] = await Promise.all([offerListing(w), offerListing(w)]);
    const results = await Promise.all([
      offer(buyer.token, a, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '1' }),
      offer(buyer.token, b, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '1' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('OFFER_LIMIT_REACHED');
  });
});
