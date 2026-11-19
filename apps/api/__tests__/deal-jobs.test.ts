import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { dealEvents, deals, listings, notifications, stockHolds, users } from '../src/db/schema.js';
import type { TxApp } from '../src/lib/tx-effects.js';
import { autoCompleteDeals, remindAgreedDeals } from '../src/services/deals/deal-jobs.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { assertHeldInvariant, insertTestDeal } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// Deal jobs (plan L3-4, spec §9.3, §14, §27 15): auto-complete by the database clock (timestamps moved back, P10), once
// under concurrent runs, never a disputed deal, a pending cancel request lapses; the agreed reminder once per period.

let catalog: TestCatalog;
let seller: TestSeller;
let buyer: TestBusinessUser;
const jobApp = { db, log: { warn: () => undefined, error: () => undefined, info: () => undefined } } as unknown as TxApp;

async function listingOf(quantity: string): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: catalog.motorsGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity,
  });
  return id;
}

const dealRow = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0]!;
const due = (id: string) => db.update(deals).set({ autoCompleteAt: sql`now() - interval '1 minute'` }).where(eq(deals.id, id));

async function reminders(businessId: string, dealId: string): Promise<number> {
  const members = (await db.select({ id: users.id }).from(users).where(eq(users.businessId, businessId))).map((u) => u.id);
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(inArray(notifications.userId, members), eq(notifications.dealId, dealId), eq(notifications.type, 'deal_agreed_reminder')));
  return rows.length;
}

beforeAll(async () => {
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  buyer = await createTestBusinessUser();
});

afterAll(async () => {
  await deleteTestBusinesses([seller?.businessId, buyer?.businessId].filter(Boolean) as string[]);
  if (seller) await deleteTestSellerExtras([seller]);
  if (catalog) await deleteTestCatalog(catalog.categoryId);
});

describe('autoCompleteDeals (§9.3)', () => {
  it('completes a due handed-over deal (auto, hold converted); leaves one not yet due and a disputed one', async () => {
    const listingId = await listingOf('5');
    const dueDeal = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '2', pricePerUnitPaise: 10_000, status: 'handed_over' });
    const notDue = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '1', pricePerUnitPaise: 10_000, status: 'handed_over' });
    const disputed = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '1', pricePerUnitPaise: 10_000, status: 'disputed' });
    await due(dueDeal.dealId);
    await db.update(deals).set({ autoCompleteAt: sql`now() - interval '1 minute'` }).where(eq(deals.id, disputed.dealId));

    await autoCompleteDeals(jobApp);

    const d = await dealRow(dueDeal.dealId);
    expect(d.status).toBe('completed');
    expect(d.completedHow).toBe('auto');
    const [hold] = await db.select().from(stockHolds).where(eq(stockHolds.dealId, dueDeal.dealId));
    expect(hold!.status).toBe('converted');
    const [l] = await db.select().from(listings).where(eq(listings.id, listingId));
    expect(Number(l!.quantity)).toBe(3);
    expect((await dealRow(notDue.dealId)).status).toBe('handed_over');
    expect((await dealRow(disputed.dealId)).status).toBe('disputed');
    await assertHeldInvariant(listingId);
  });

  it('two concurrent runs complete a deal once (one event); a pending cancel request lapses', async () => {
    const listingId = await listingOf('5');
    const d = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '2', pricePerUnitPaise: 10_000, status: 'handed_over' });
    await db
      .update(deals)
      .set({ cancelRequestedSide: 'buyer', cancelRequestedAt: sql`now()`, cancelRequestedReason: 'no_longer_needed' })
      .where(eq(deals.id, d.dealId));
    await due(d.dealId);

    await Promise.all([autoCompleteDeals(jobApp), autoCompleteDeals(jobApp)]);

    const row = await dealRow(d.dealId);
    expect(row.status).toBe('completed');
    expect(row.cancelRequestedSide).toBeNull();
    const events = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, d.dealId), eq(dealEvents.code, 'auto_completed')));
    expect(events).toHaveLength(1);
    const [l] = await db.select().from(listings).where(eq(listings.id, listingId));
    expect(Number(l!.quantity)).toBe(3);
    await assertHeldInvariant(listingId);
  });
});

describe('remindAgreedDeals (§9.3)', () => {
  it('nudges both sides once per period: not again the same day, again after the period', async () => {
    const listingId = await listingOf('5');
    const fresh = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '1', pricePerUnitPaise: 10_000 });
    const stale = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '1', pricePerUnitPaise: 10_000 });
    await db.update(deals).set({ acceptedAt: sql`now() - interval '8 days'` }).where(eq(deals.id, stale.dealId));

    await remindAgreedDeals(jobApp);
    expect(await reminders(buyer.businessId, stale.dealId)).toBe(1);
    expect(await reminders(seller.businessId, stale.dealId)).toBe(1);
    expect(await reminders(buyer.businessId, fresh.dealId)).toBe(0);

    await remindAgreedDeals(jobApp);
    expect(await reminders(buyer.businessId, stale.dealId)).toBe(1);

    await db.update(deals).set({ agreedRemindedAt: sql`now() - interval '8 days'` }).where(eq(deals.id, stale.dealId));
    await remindAgreedDeals(jobApp);
    expect(await reminders(buyer.businessId, stale.dealId)).toBe(2);
    expect(await reminders(seller.businessId, stale.dealId)).toBe(2);
    expect((await dealRow(stale.dealId)).status).toBe('agreed');
  });
});
