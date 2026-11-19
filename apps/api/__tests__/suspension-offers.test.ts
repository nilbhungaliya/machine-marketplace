import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { deals, offers, stockHolds } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { addTestMember, assertHeldInvariant, insertTestDeal, insertTestOffer, insertTestThread } from './_helpers/test-deals.js';
import { auth, call, createOfferWorld, extraSeller, offerListing, offerRow, setTestSettings, type OfferWorld } from './_helpers/test-offers.js';

// L2-4: an owner's suspension or block closes offers (F6 + F7 spec §7.7, plan review I7).

let w: OfferWorld;
let restore: () => Promise<void>;
let moderator: { id: string; token: string };

const post = (token: string, url: string, body: object = {}) => call(w.app, token, 'POST', url, body);
const adminAct = (userId: string, action: 'suspend' | 'reinstate') =>
  w.app.inject({ method: 'POST', url: `/admin/users/${userId}/${action}`, headers: auth(moderator.token), payload: { reason: 'Testing offers on suspension' } });
async function sendOffer(buyerToken: string, listingId: string, quantity = '1'): Promise<string> {
  const res = await post(buyerToken, `/listings/${listingId}/offers`, { kind: 'offer', pricePerUnitPaise: 90_000, quantity });
  expect(res.statusCode).toBe(200);
  return res.json().data.offer.id;
}

beforeAll(async () => {
  w = await createOfferWorld(3);
  moderator = await createTestAdmin('moderator');
  restore = await setTestSettings({ offer_open_limit_unverified: 50, enquiry_new_per_day_unverified: 100 });
});

afterAll(async () => {
  await restore?.();
  await deleteTestAdmins([moderator?.id].filter(Boolean) as string[]);
  await w?.cleanup();
});

describe('suspension and offers', () => {
  it('an owner’s suspension closes its listings’ chains and its buyer chains; members and reinstatement change nothing; deals continue', async () => {
    const s2 = await extraSeller(w.catalog.categoryId);
    const listingId = await offerListing(w, { quantity: '5' }, s2);
    const pending = await sendOffer(w.buyers[0]!.token, listingId);
    const t = await insertTestThread({ listingId, buyerBusinessId: w.buyers[1]!.businessId, buyerUserId: w.buyers[1]!.userId });
    const backup = await insertTestOffer({ threadId: t.id, status: 'backup', pricePerUnitPaise: 90_000, quantity: '6' });
    const deal = await insertTestDeal({ listing: { id: listingId }, buyer: w.buyers[2]!, quantity: '2', pricePerUnitPaise: 100_000 });
    // S2 buys from the world's seller.
    const asBuyer = await sendOffer(s2.token, await offerListing(w));

    // A sales member's suspension changes no offer.
    const sales = await addTestMember(s2.businessId, 'sales');
    expect((await adminAct(sales.userId, 'suspend')).statusCode).toBe(200);
    expect((await offerRow(pending)).status).toBe('pending');
    expect((await offerRow(asBuyer)).status).toBe('pending');

    expect((await adminAct(s2.userId, 'suspend')).statusCode).toBe(200);
    expect(await offerRow(pending)).toMatchObject({ status: 'closed', closeReason: 'listing_unavailable' });
    expect(await offerRow(backup.id)).toMatchObject({ status: 'closed', closeReason: 'listing_unavailable' });
    expect(await offerRow(asBuyer)).toMatchObject({ status: 'closed', closeReason: 'account_inactive' });
    const [d] = await db.select().from(deals).where(eq(deals.id, deal.dealId));
    expect(d!.status).toBe('agreed');
    const [hold] = await db.select().from(stockHolds).where(eq(stockHolds.dealId, deal.dealId));
    expect(hold!.status).toBe('active');
    await assertHeldInvariant(listingId);

    expect((await adminAct(s2.userId, 'reinstate')).statusCode).toBe(200);
    for (const id of [pending, backup.id, asBuyer]) expect((await offerRow(id)).status).toBe('closed');
  });

  it('the owner’s suspension racing a buyer’s offer settles both, without a deadlock', async () => {
    for (let round = 0; round < 3; round++) {
      const s3 = await extraSeller(w.catalog.categoryId);
      const listingId = await offerListing(w, { quantity: '5' }, s3);
      const [suspend, offer] = await Promise.all([
        adminAct(s3.userId, 'suspend'),
        post(w.buyers[round]!.token, `/listings/${listingId}/offers`, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '1' }),
      ]);
      expect(suspend.statusCode).toBe(200);
      // Either the offer committed first (then the suspension closed it) or it found the listing no longer public.
      expect([200, 404]).toContain(offer.statusCode);
      const open = await db
        .select({ id: offers.id })
        .from(offers)
        .where(and(eq(offers.listingId, listingId), inArray(offers.status, ['pending', 'backup'])));
      expect(open).toHaveLength(0);
    }
  });
});
