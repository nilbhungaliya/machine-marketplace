import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { chatMessages, listings, offers } from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { releaseHold } from '../src/services/deals/holds.js';
import { closeChainsBetween, reconcileOffersForListing } from '../src/services/offers/reconcile.js';
import { assertHeldInvariant, insertTestDeal, insertTestOffer, insertTestThread } from './_helpers/test-deals.js';
import { call, createOfferWorld, offerListing, offerRow, setTestSettings, type OfferWorld } from './_helpers/test-offers.js';

// L2-4: reconcile, backups, revive, block close (F6 + F7 spec §7.5, §7.7).

let w: OfferWorld;
let restore: () => Promise<void>;
const jobApp = { db, log: { warn: () => undefined } } as unknown as TxApp;

const post = (token: string, url: string, body: object = {}) => call(w.app, token, 'POST', url, body);
async function sendOffer(buyerToken: string, listingId: string, quantity: string, price = 90_000): Promise<string> {
  const res = await post(buyerToken, `/listings/${listingId}/offers`, { kind: 'offer', pricePerUnitPaise: price, quantity });
  expect(res.statusCode).toBe(200);
  return res.json().data.offer.id;
}
const reconcile = (listingId: string) => runTx(jobApp, (tx) => reconcileOffersForListing(tx, listingId));
const linesIn = async (threadIds: string[]) =>
  (await db.select({ n: count() }).from(chatMessages).where(and(inArray(chatMessages.threadId, threadIds), eq(chatMessages.kind, 'system'))))[0]!.n;

beforeAll(async () => {
  w = await createOfferWorld(3);
  restore = await setTestSettings({ offer_open_limit_unverified: 50, enquiry_new_per_day_unverified: 100, offer_backup_max_days: 14 });
});

afterAll(async () => {
  await restore?.();
  await w?.cleanup();
});

describe('backups and revive', () => {
  it('accept A (3 of 5) → B (2) stays pending, C (4) becomes a backup; releasing A revives C for the seller', async () => {
    const listingId = await offerListing(w, { quantity: '5' });
    const a = await sendOffer(w.buyers[0]!.token, listingId, '3');
    const b = await sendOffer(w.buyers[1]!.token, listingId, '2');
    const c = await sendOffer(w.buyers[2]!.token, listingId, '4');
    const accepted = await post(w.seller.token, `/offers/${a}/accept`);
    expect(accepted.statusCode).toBe(200);
    expect((await offerRow(b)).status).toBe('pending');
    const backup = await offerRow(c);
    expect(backup).toMatchObject({ status: 'backup', expiresAt: null });
    expect(backup.backupSince).not.toBeNull();

    const before = new Date();
    await runTx(jobApp, async (tx) => {
      await releaseHold(tx, accepted.json().data.dealId);
      await reconcileOffersForListing(tx, listingId);
    });
    const revived = await offerRow(c);
    expect(revived).toMatchObject({ status: 'pending', turn: 'seller', needsReconfirm: false });
    expect(revived.expiresAt!.getTime()).toBeGreaterThan(before.getTime() + 47 * 3_600_000);
    await assertHeldInvariant(listingId);

    // Twice: nothing changes the second time.
    const threads = [(await offerRow(b)).threadId, revived.threadId];
    const lines = await linesIn(threads);
    const snapshot = await db.select().from(offers).where(inArray(offers.id, [b, c]));
    await reconcile(listingId);
    expect(await linesIn(threads)).toBe(lines);
    expect(await db.select().from(offers).where(inArray(offers.id, [b, c]))).toEqual(snapshot);
  });

  it('leaves lapsed rows for the expiry job: a past-due pending row is not moved to backup, an old backup is not revived', async () => {
    const listingId = await offerListing(w, { quantity: '5' });
    const a = await sendOffer(w.buyers[0]!.token, listingId, '3');
    const lapsed = await sendOffer(w.buyers[1]!.token, listingId, '4');
    await db.update(offers).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(offers.id, lapsed));
    const t = await insertTestThread({ listingId, buyerBusinessId: w.buyers[2]!.businessId, buyerUserId: w.buyers[2]!.userId });
    const oldBackup = await insertTestOffer({ threadId: t.id, status: 'backup', pricePerUnitPaise: 90_000, quantity: '1' });
    await db.update(offers).set({ backupSince: sql`now() - interval '15 days'` }).where(eq(offers.id, oldBackup.id));

    expect((await post(w.seller.token, `/offers/${a}/accept`)).statusCode).toBe(200);
    expect((await offerRow(lapsed)).status).toBe('pending');
    // 2 left would fit the 1-unit backup, but it is past offer_backup_max_days (14).
    expect((await offerRow(oldBackup.id)).status).toBe('backup');
  });

  it('a revived seller row needs reconfirming before the buyer can accept', async () => {
    const listingId = await offerListing(w, { quantity: '5' });
    const first = await sendOffer(w.buyers[0]!.token, listingId, '3', 80_000);
    const counter = await post(w.seller.token, `/offers/${first}/counter`, { pricePerUnitPaise: 95_000, quantity: '3' });
    const sellerRow = counter.json().data.id as string;
    // Another deal takes 3: the seller's counter no longer fits.
    const deal = await insertTestDeal({ listing: { id: listingId }, buyer: w.buyers[1]!, quantity: '3', pricePerUnitPaise: 100_000 });
    await reconcile(listingId);
    expect((await offerRow(sellerRow)).status).toBe('backup');
    await runTx(jobApp, async (tx) => {
      await releaseHold(tx, deal.dealId);
      await reconcileOffersForListing(tx, listingId);
    });
    expect(await offerRow(sellerRow)).toMatchObject({ status: 'pending', turn: 'seller', needsReconfirm: true });

    const early = await post(w.buyers[0]!.token, `/offers/${sellerRow}/accept`);
    expect([early.statusCode, early.json().code]).toEqual([409, 'OFFER_NEEDS_RECONFIRM']);
    expect((await post(w.seller.token, `/offers/${sellerRow}/reconfirm`)).statusCode).toBe(200);
    const ok = await post(w.buyers[0]!.token, `/offers/${sellerRow}/accept`);
    expect(ok.statusCode).toBe(200);
    await assertHeldInvariant(listingId);
  });

  it('pausing closes pending offers and backups for good (still closed after resume)', async () => {
    const listingId = await offerListing(w, { quantity: '5' });
    const pending = await sendOffer(w.buyers[0]!.token, listingId, '1');
    const t = await insertTestThread({ listingId, buyerBusinessId: w.buyers[1]!.businessId, buyerUserId: w.buyers[1]!.userId });
    const backup = await insertTestOffer({ threadId: t.id, status: 'backup', pricePerUnitPaise: 90_000, quantity: '6' });
    expect((await post(w.seller.token, `/listings/${listingId}/actions`, { action: 'pause' })).statusCode).toBe(200);
    expect(await offerRow(pending)).toMatchObject({ status: 'closed', closeReason: 'listing_unavailable' });
    expect(await offerRow(backup.id)).toMatchObject({ status: 'closed', closeReason: 'listing_unavailable' });
    expect((await post(w.seller.token, `/listings/${listingId}/actions`, { action: 'resume' })).statusCode).toBe(200);
    expect((await offerRow(pending)).status).toBe('closed');
    expect((await offerRow(backup.id)).status).toBe('closed');
  });

  it('a price model change closes the chain that no longer fits (listing_changed)', async () => {
    const listingId = await offerListing(w);
    const id = await sendOffer(w.buyers[0]!.token, listingId, '1');
    await db.update(listings).set({ priceModel: 'fixed' }).where(eq(listings.id, listingId));
    await reconcile(listingId);
    expect(await offerRow(id)).toMatchObject({ status: 'closed', closeReason: 'listing_changed' });
  });
});

describe('closeChainsBetween', () => {
  it('closes the chains between two businesses in both directions, and no others', async () => {
    const x = w.buyers[0]!;
    // X buys from the seller …
    const sellerListing = await offerListing(w);
    const xBuys = await sendOffer(x.token, sellerListing, '1');
    // … and the seller buys from X.
    const xListing = await offerListing(w, {}, { ...w.seller, businessId: x.businessId, userId: x.userId });
    const t = await insertTestThread({ listingId: xListing, buyerBusinessId: w.seller.businessId, buyerUserId: w.seller.userId });
    const sellerBuys = await insertTestOffer({ threadId: t.id, pricePerUnitPaise: 90_000, quantity: '1' });
    // A third business's chain on the same listing stays.
    const other = await sendOffer(w.buyers[1]!.token, sellerListing, '1');

    await runTx(jobApp, (tx) => closeChainsBetween(tx, x.businessId, w.seller.businessId));
    expect(await offerRow(xBuys)).toMatchObject({ status: 'closed', closeReason: 'blocked' });
    expect(await offerRow(sellerBuys.id)).toMatchObject({ status: 'closed', closeReason: 'blocked' });
    expect((await offerRow(other)).status).toBe('pending');
  });
});
