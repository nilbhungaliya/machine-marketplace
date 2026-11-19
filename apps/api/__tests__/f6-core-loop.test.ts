import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { CONSENT_WORDING_VERSION, type DealView } from '@mpm/shared-types';
import { db } from '../src/db/index.js';
import { chatThreads, contactShareConsents, dealEvents, dealReviews, deals, listings, notifications, stockHolds, users } from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { autoCompleteDeals } from '../src/services/deals/deal-jobs.js';
import { syncReservation } from '../src/services/deals/holds.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { assertHeldInvariant, insertTestDeal } from './_helpers/test-deals.js';
import { auth, call, createOfferWorld, extraSeller, offerListing, offerRow, setTestSettings, type OfferWorld } from './_helpers/test-offers.js';

// Batch I-1 (F6 + F7 plan): the cross-lane cases no single lane could write. The core loop end to end through the API,
// the reveal inside accept, a block and an owner's suspension leaving the deal finishable, and confirm-received racing
// the auto-complete job. `assertHeldInvariant` after every stock move (Review focus 2). The Deal record's number after
// both ticks and after a withdraw is `deals-read.test.ts`; an admin removal of `agreed` vs `handed_over` deals is
// `deals-steps.test.ts`.

let w: OfferWorld;
let restore: () => Promise<void>;
let moderator: { id: string; token: string };
const jobApp = { db, log: { warn: () => undefined, error: () => undefined, info: () => undefined } } as unknown as TxApp;
const PLANTED = '9876543210';

const post = (token: string, url: string, body: object = {}) => call(w.app, token, 'POST', url, body);
const get = (token: string, url: string) => call(w.app, token, 'GET', url);

async function ok(res: Promise<{ statusCode: number; json: () => { data?: unknown; code?: string } }>) {
  const r = await res;
  if (r.statusCode !== 200) throw new Error(`expected 200, got ${r.statusCode} ${JSON.stringify(r.json())}`);
  return r.json().data as Record<string, unknown> & { id: string };
}
async function sendOffer(token: string, listingId: string, quantity: string, price: number): Promise<string> {
  const data = (await ok(post(token, `/listings/${listingId}/offers`, { kind: 'offer', pricePerUnitPaise: price, quantity }))) as unknown as {
    offer: { id: string };
  };
  return data.offer.id;
}
const counter = async (token: string, offerId: string, price: number, quantity: string) =>
  (await ok(post(token, `/offers/${offerId}/counter`, { pricePerUnitPaise: price, quantity }))).id;
const accept = async (token: string, offerId: string) =>
  ((await ok(post(token, `/offers/${offerId}/accept`))) as unknown as { dealId: string }).dealId;

const listingRow = async (id: string) => (await db.select().from(listings).where(eq(listings.id, id)))[0]!;
const dealRow = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0]!;

/** Notification types for every member of a business, optionally for one deal. */
async function typesFor(businessId: string, where: { dealId?: string; threadId?: string } = {}): Promise<string[]> {
  const members = (await db.select({ id: users.id }).from(users).where(eq(users.businessId, businessId))).map((u) => u.id);
  const conds = [inArray(notifications.userId, members)];
  if (where.dealId) conds.push(eq(notifications.dealId, where.dealId));
  if (where.threadId) conds.push(eq(notifications.threadId, where.threadId));
  return (await db.select({ type: notifications.type }).from(notifications).where(and(...conds))).map((n) => n.type);
}

beforeAll(async () => {
  w = await createOfferWorld(2);
  moderator = await createTestAdmin('moderator');
  restore = await setTestSettings({ offer_open_limit_unverified: 50, enquiry_new_per_day_unverified: 100, offer_backup_max_days: 14 });
});

afterAll(async () => {
  await restore?.();
  await deleteTestAdmins([moderator?.id].filter(Boolean) as string[]);
  await w?.cleanup();
});

describe('the core loop end to end (§20 close-out)', () => {
  it('enquiry → message → offer → counter ×2 → accept → backup → cancel → revive → reconfirm → accept → hand over → confirm → reviews', async () => {
    const seller = w.seller;
    const [a, b] = [w.buyers[0]!, w.buyers[1]!];
    const listingId = await offerListing(w, { quantity: '5', pricePaise: 100_000 });

    // A enquires and writes a number into the chat.
    const enquiry = (await ok(post(a.token, `/listings/${listingId}/enquiry`, { note: 'Is this still available?' }))) as unknown as { threadId: string };
    const threadA = enquiry.threadId;
    await ok(post(a.token, `/threads/${threadA}/messages`, { clientMessageId: randomUUID(), text: `Call me on ${PLANTED}` }));
    const sellerSees = (await ok(get(seller.token, `/threads/${threadA}/messages`))) as unknown as { text: string | null }[];
    expect(JSON.stringify(sellerSees)).not.toContain(PLANTED);

    // A: 80 000 × 3 → seller 95 000 → A 90 000 (counter ×2). B: 90 000 × 4, seller counters 98 000 × 4.
    const a1 = await sendOffer(a.token, listingId, '3', 80_000);
    const a2 = await counter(seller.token, a1, 95_000, '3');
    const a3 = await counter(a.token, a2, 90_000, '3');
    const b1 = await sendOffer(b.token, listingId, '4', 90_000);
    const b2 = await counter(seller.token, b1, 98_000, '4');
    const b2Thread = (await offerRow(b1)).threadId;

    // The seller accepts A's last counter: a deal at 90 000 × 3, the hold, B's 4 no longer fit → backup.
    const dealA = await accept(seller.token, a3);
    expect(await dealRow(dealA)).toMatchObject({ status: 'agreed', pricePerUnitPaise: 90_000, quantity: '3.000', totalPaise: 270_000n });
    expect(Number((await listingRow(listingId)).heldQuantity)).toBe(3);
    expect((await listingRow(listingId)).status).toBe('live');
    expect((await offerRow(b2)).status).toBe('backup');
    await assertHeldInvariant(listingId);

    // A cancels the agreed deal: hold released, B's row revives for the seller and needs reconfirming.
    await ok(post(a.token, `/deals/${dealA}/cancel`, { reason: 'found_elsewhere' }));
    expect((await dealRow(dealA)).status).toBe('cancelled');
    expect(await offerRow(b2)).toMatchObject({ status: 'pending', turn: 'seller', needsReconfirm: true });
    await assertHeldInvariant(listingId);
    const early = await post(b.token, `/offers/${b2}/accept`);
    expect([early.statusCode, early.json().code]).toEqual([409, 'OFFER_NEEDS_RECONFIRM']);
    await ok(post(seller.token, `/offers/${b2}/reconfirm`));
    const dealB = await accept(b.token, b2);
    expect(await dealRow(dealB)).toMatchObject({ status: 'agreed', quantity: '4.000', pricePerUnitPaise: 98_000 });
    expect(Number((await listingRow(listingId)).heldQuantity)).toBe(4);
    await assertHeldInvariant(listingId);

    // Hand over, then the buyer confirms: the hold converts, quantity 5 → 1, the listing stays live.
    await ok(post(seller.token, `/deals/${dealB}/hand-over`));
    expect((await dealRow(dealB)).status).toBe('handed_over');
    await ok(post(b.token, `/deals/${dealB}/confirm-received`));
    expect(await dealRow(dealB)).toMatchObject({ status: 'completed', completedHow: 'buyer_confirmed' });
    const after = await listingRow(listingId);
    expect([Number(after.quantity), Number(after.heldQuantity), after.status]).toEqual([1, 0, 'live']);
    const [hold] = await db.select().from(stockHolds).where(eq(stockHolds.dealId, dealB));
    expect(hold!.status).toBe('converted');
    await assertHeldInvariant(listingId);

    // Both reviews: the first stays blind, the second publishes both.
    const first = (await ok(post(b.token, `/deals/${dealB}/review`, { ratings: { matched_listing: 5, communication: 4, on_time: 5 } }))) as unknown as {
      mine: { publishedAt: string | null };
    };
    expect(first.mine.publishedAt).toBeNull();
    await ok(post(seller.token, `/deals/${dealB}/review`, { ratings: { communication: 5, payment: 5, pickup: 4 } }));
    const reviews = await db.select().from(dealReviews).where(eq(dealReviews.dealId, dealB));
    expect(reviews).toHaveLength(2);
    expect(reviews.every((r) => r.publishedAt !== null)).toBe(true);

    // Notifications of the right types at each step, and no planted number in any rendered text.
    expect(await typesFor(seller.businessId, { threadId: threadA })).toEqual(expect.arrayContaining(['enquiry_new', 'offer_new', 'offer_countered', 'deal_cancelled']));
    expect(await typesFor(a.businessId, { threadId: threadA })).toEqual(expect.arrayContaining(['offer_countered', 'offer_accepted']));
    expect(await typesFor(b.businessId)).toEqual(expect.arrayContaining(['offer_countered', 'offer_backup', 'deal_handed_over']));
    // B accepted the seller's revived row: the seller is told (accept notifies the other side), as of the revive.
    expect(await typesFor(seller.businessId, { threadId: b2Thread })).toEqual(expect.arrayContaining(['offer_new', 'offer_revived', 'offer_accepted']));
    expect(await typesFor(seller.businessId, { dealId: dealB })).toEqual(expect.arrayContaining(['deal_completed', 'review_received']));
    for (const who of [seller, a, b]) {
      const page = (await ok(get(who.token, '/notifications'))) as unknown as { items: unknown[] };
      expect(page.items.length).toBeGreaterThan(0);
      expect(JSON.stringify(page)).not.toContain(PLANTED);
    }
  });
});

describe('reveal inside accept (§6.6, R6)', () => {
  it('both sides’ grants already in the thread: the accept that makes the deal reveals the numbers in the same transaction', async () => {
    const buyer = w.buyers[0]!;
    const listingId = await offerListing(w, { quantity: '2' });
    const offerId = await sendOffer(buyer.token, listingId, '1', 90_000);
    const { threadId } = await offerRow(offerId);
    // Grants written as `shareContact` writes them (a thread's earlier, released deal is the way in through the API).
    for (const side of [buyer, w.seller]) {
      await db.insert(contactShareConsents).values({
        kind: 'grant', threadId, businessId: side.businessId, userId: side.userId, phoneShown: side.phone, phoneSource: 'owner_phone',
        wordingVersion: CONSENT_WORDING_VERSION,
      });
    }
    expect((await db.select().from(chatThreads).where(eq(chatThreads.id, threadId)))[0]!.contactUnlockedAt).toBeNull();

    const dealId = await accept(w.seller.token, offerId);
    expect((await db.select().from(chatThreads).where(eq(chatThreads.id, threadId)))[0]!.contactUnlockedAt).not.toBeNull();
    expect(await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.code, 'contact_shared')))).toHaveLength(1);
    const view = (await ok(get(buyer.token, `/deals/${dealId}`))) as unknown as DealView;
    expect(view.contact).toMatchObject({ revealed: true, number: w.seller.phone });
  });
});

describe('a block or a suspension leaves the deal finishable (§6.11, §7.7)', () => {
  it('a block closes the pair’s open offers; their agreed deal can still be handed over and confirmed', async () => {
    const buyer = w.buyers[1]!;
    const dealListing = await offerListing(w, { quantity: '2' });
    const otherListing = await offerListing(w, { quantity: '2' });
    const dealId = await accept(w.seller.token, await sendOffer(buyer.token, dealListing, '2', 90_000));
    expect((await listingRow(dealListing)).status).toBe('reserved');
    const open = await sendOffer(buyer.token, otherListing, '1', 90_000);
    const { threadId } = await offerRow(open);

    await ok(post(buyer.token, `/threads/${threadId}/block`));
    expect(await offerRow(open)).toMatchObject({ status: 'closed', closeReason: 'blocked' });
    const refused = await post(buyer.token, `/listings/${otherListing}/offers`, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '1' });
    expect(refused.statusCode).toBe(403);

    await ok(post(w.seller.token, `/deals/${dealId}/hand-over`));
    await ok(post(buyer.token, `/deals/${dealId}/confirm-received`));
    expect((await dealRow(dealId)).status).toBe('completed');
    const l = await listingRow(dealListing);
    expect([Number(l.quantity), l.status]).toEqual([0, 'sold']);
    await assertHeldInvariant(dealListing);
    await assertHeldInvariant(otherListing);
  });

  it('the seller owner’s suspension closes its chains; the agreed deal continues and the buyer can cancel it', async () => {
    const buyer = w.buyers[0]!;
    const s2 = await extraSeller(w.catalog.categoryId);
    const listingId = await offerListing(w, { quantity: '5' }, s2);
    const dealId = await accept(s2.token, await sendOffer(buyer.token, listingId, '2', 90_000));
    const pending = await sendOffer(w.buyers[1]!.token, listingId, '1', 90_000);

    const suspend = await w.app.inject({
      method: 'POST', url: `/admin/users/${s2.userId}/suspend`, headers: auth(moderator.token), payload: { reason: 'Testing the core loop' },
    });
    expect(suspend.statusCode).toBe(200);
    expect((await offerRow(pending)).status).toBe('closed');
    expect((await dealRow(dealId)).status).toBe('agreed');
    await assertHeldInvariant(listingId);

    await ok(post(buyer.token, `/deals/${dealId}/cancel`, { reason: 'found_elsewhere' }));
    expect((await dealRow(dealId)).status).toBe('cancelled');
    const [hold] = await db.select().from(stockHolds).where(eq(stockHolds.dealId, dealId));
    expect(hold!.status).toBe('released');
    expect(Number((await listingRow(listingId)).heldQuantity)).toBe(0);
    await assertHeldInvariant(listingId);
  });
});

describe('confirm-received racing the auto-complete job (§9.3, §9.4)', () => {
  it('exactly one completion and one hold conversion: quantity down once', async () => {
    const buyer = w.buyers[1]!;
    for (let round = 0; round < 3; round++) {
      const listingId = await offerListing(w, { quantity: '5' });
      const d = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '2', pricePerUnitPaise: 90_000, status: 'handed_over' });
      await runTx({ ...jobApp } as TxApp, (tx) => syncReservation(tx, listingId));
      await db.update(deals).set({ autoCompleteAt: sql`now() - interval '1 minute'` }).where(eq(deals.id, d.dealId));

      const [confirm] = await Promise.all([post(buyer.token, `/deals/${d.dealId}/confirm-received`), autoCompleteDeals(jobApp)]);
      expect([200, 409]).toContain(confirm.statusCode);

      const row = await dealRow(d.dealId);
      expect(row.status).toBe('completed');
      expect(row.completedHow).toBe(confirm.statusCode === 200 ? 'buyer_confirmed' : 'auto');
      const completions = await db
        .select({ id: dealEvents.id })
        .from(dealEvents)
        .where(and(eq(dealEvents.dealId, d.dealId), inArray(dealEvents.code, ['received', 'auto_completed'])));
      expect(completions).toHaveLength(1);
      const holds = await db.select().from(stockHolds).where(eq(stockHolds.dealId, d.dealId));
      expect(holds.map((h) => h.status)).toEqual(['converted']);
      expect(Number((await listingRow(listingId)).quantity)).toBe(3);
      await assertHeldInvariant(listingId);
    }
  });
});
