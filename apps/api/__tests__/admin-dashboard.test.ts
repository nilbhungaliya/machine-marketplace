import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { businesses, chatThreads, deals, listings, partRequests } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { periodMetrics, snapshotMetrics } from '../src/services/admin-insights/dashboard.js';
import { resolveDashboardPeriod } from '../src/services/admin-insights/period.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { insertTestDeal, insertTestThread } from './_helpers/test-deals.js';
import { testRunId } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestHistory, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { createTestPartTree, insertTestPartRequest, insertTestReply, type TestPartTree } from './_helpers/test-part-requests.js';
import { insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// Admin close-out plan A1-1 (spec §6.2, R2, R3; review focus 5): each dashboard definition on planted data. Suites
// share one test database, so every scenario reads a city of its own (`city(<x>)`, unique to the run).

const run = testRunId();
const city = (x: string) => `Dash ${run} ${x}`;
const today = istToday();
const p7 = resolveDashboardPeriod({ range: '7d' }, today);
/** An IST wall-clock instant. */
const ist = (day: string, hm: string) => new Date(`${day}T${hm}:00+05:30`);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

let tree: TestPartTree;
let otherTree: TestPartTree;
let seller: TestSeller;
let buyer: TestBusinessUser;
const businessIds: string[] = [];
const sellers: TestSeller[] = [];

async function newBuyer(cityName: string | null = null): Promise<TestBusinessUser> {
  const b = await createTestBusinessUser();
  businessIds.push(b.businessId);
  if (cityName) await db.update(businesses).set({ city: cityName }).where(eq(businesses.id, b.businessId));
  return b;
}

async function part(cityName: string, extra: Partial<Parameters<typeof insertTestListing>[1]> = {}): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: tree.partGroup.id,
    city: cityName,
    quantity: '100',
    ...extra,
  });
  return id;
}

beforeAll(async () => {
  tree = await createTestPartTree();
  otherTree = await createTestPartTree();
  seller = await createTestSeller({ machineCategoryId: tree.machineCategory.id });
  sellers.push(seller);
  businessIds.push(seller.businessId);
  buyer = await newBuyer();
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras(sellers);
  await tree?.cleanup();
  await otherTree?.cleanup();
});

describe('period (R3)', () => {
  it('7 days end today; a custom range over 366 days is refused', () => {
    expect(p7).toMatchObject({ from: addDays(today, -6), to: today, prevFrom: addDays(today, -13), prevTo: addDays(today, -7) });
    expect(p7.granularity).toBe('day');
    const from = addDays(today, -366);
    expect(() => resolveDashboardPeriod({ range: 'custom', from, to: today }, today)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'DASHBOARD_RANGE_INVALID' }),
    );
    expect(resolveDashboardPeriod({ range: 'custom', from: addDays(today, -365), to: today }, today).days).toBe(366);
    expect(() => resolveDashboardPeriod({ range: 'custom', from: today, to: addDays(today, 1) }, today)).toThrow(
      expect.objectContaining({ code: 'DASHBOARD_RANGE_INVALID' }),
    );
  });
});

describe('deals (§6.2, R2)', () => {
  it('count by IST day edges and the listing’s city; value leaves cancelled deals out', async () => {
    const c = city('deals');
    const here = await part(c);
    const elsewhere = await part(city('deals-elsewhere'));
    const localBuyer = await newBuyer(c);

    const inPeriod = await insertTestDeal({ listing: { id: here }, buyer, quantity: '2', pricePerUnitPaise: 150_000 });
    const before = await insertTestDeal({ listing: { id: here }, buyer: await newBuyer(), quantity: '1', pricePerUnitPaise: 70_000 });
    await insertTestDeal({ listing: { id: here }, buyer: await newBuyer(), quantity: '1', pricePerUnitPaise: 90_000, status: 'cancelled' });
    // A buyer from the city on a listing elsewhere: not this city's deal.
    await insertTestDeal({ listing: { id: elsewhere }, buyer: localBuyer, quantity: '1', pricePerUnitPaise: 11_000 });

    await db.update(deals).set({ acceptedAt: ist(p7.from, '00:01') }).where(eq(deals.id, inPeriod.dealId));
    await db.update(deals).set({ acceptedAt: ist(p7.prevTo, '23:59') }).where(eq(deals.id, before.dealId));

    const m = await periodMetrics(db, { city: c.toUpperCase() }, p7);
    expect(m.deals).toEqual({ value: 2, previous: 1 });
    expect(m.dealValuePaise).toEqual({ value: 300_000, previous: 70_000 });
  });
});

describe('businesses (§6.2)', () => {
  it('new businesses need a trade name; the category filter reads the business’s categories', async () => {
    const c = city('biz');
    const named = await newBuyer(c);
    const unnamed = await newBuyer(c);
    await db.update(businesses).set({ tradeName: '  ' }).where(eq(businesses.id, unnamed.businessId));
    await db.update(businesses).set({ categories: [tree.machineCategory.id] }).where(eq(businesses.id, named.businessId));

    const m = await periodMetrics(db, { city: c }, p7);
    expect(m.newBusinesses.value).toBe(1);
    expect((await snapshotMetrics(db, { city: c })).businesses).toBe(1);
    expect((await snapshotMetrics(db, { city: c, categoryId: tree.machineCategory.id })).businesses).toBe(1);
    expect((await snapshotMetrics(db, { city: c, categoryId: otherTree.machineCategory.id })).businesses).toBe(0);
  });
});

describe('category filter (R2)', () => {
  it('counts a listing in a part group under the root, not one under another root', async () => {
    const c = city('cat');
    await part(c);
    await part(c, { categoryId: otherTree.partGroup.id });
    expect((await snapshotMetrics(db, { city: c })).activeListings).toBe(2);
    expect((await snapshotMetrics(db, { city: c, categoryId: tree.machineCategory.id })).activeListings).toBe(1);
  });
});

describe('reply rate and first reply (§6.2)', () => {
  it('measures threads at least 24 h old: answered within 24 h over measured', async () => {
    const c = city('reply');
    const set = async (createdHoursAgo: number, replyAfterHours: number | null) => {
      const t = await insertTestThread({ listingId: await part(c), buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
      const created = hoursAgo(createdHoursAgo);
      await db
        .update(chatThreads)
        .set({ createdAt: created, firstSellerReplyAt: replyAfterHours == null ? null : new Date(created.getTime() + replyAfterHours * 3_600_000) })
        .where(eq(chatThreads.id, t.id));
    };
    await set(25, 23);
    await set(26, 25);
    await set(2, null);
    const m = await periodMetrics(db, { city: c }, p7);
    expect(m.replyRate24h.value).toBe(0.5);
    expect(m.enquiries.value).toBe(3);
  });

  it('median first reply of 1 h, 3 h and 5 h is 3 h', async () => {
    const c = city('median');
    for (const h of [1, 3, 5]) {
      const t = await insertTestThread({ listingId: await part(c), buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
      const created = hoursAgo(30);
      await db
        .update(chatThreads)
        .set({ createdAt: created, firstSellerReplyAt: new Date(created.getTime() + h * 3_600_000) })
        .where(eq(chatThreads.id, t.id));
    }
    expect((await periodMetrics(db, { city: c }, p7)).firstReplyMedianHours.value).toBe(3);
  });
});

describe('requirements (§6.2)', () => {
  it('match rate counts a delivered reply; fulfilment is the median hours', async () => {
    const c = city('req');
    const b = await newBuyer(c);
    const answered = await insertTestPartRequest({ businessId: b.businessId, userId: b.userId, categoryId: tree.partGroup.id, unitId: tree.unitId });
    await insertTestPartRequest({ businessId: b.businessId, userId: b.userId, categoryId: tree.partGroup.id, unitId: tree.unitId });
    await insertTestReply({ partRequestId: answered.id, sellerBusinessId: seller.businessId, listingId: await part(city('req-l')), userId: seller.userId });
    const m = await periodMetrics(db, { city: c }, p7);
    expect(m.requirementsPosted.value).toBe(2);
    expect(m.requirementMatchRate.value).toBe(0.5);

    const f = city('fulfil');
    const fb = await newBuyer(f);
    for (const h of [10, 30]) {
      const r = await insertTestPartRequest({
        businessId: fb.businessId, userId: fb.userId, categoryId: tree.partGroup.id, unitId: tree.unitId, status: 'fulfilled',
      });
      await db.update(partRequests).set({ firstPostedAt: sql`${partRequests.fulfilledAt} - make_interval(hours => ${h})` }).where(eq(partRequests.id, r.id));
    }
    expect((await periodMetrics(db, { city: f }, p7)).fulfilmentMedianHours.value).toBe(20);
  });
});

describe('listings (§6.2)', () => {
  it('sold counts a listing with two sold rows once; parts available leaves fully held parts out', async () => {
    const c = city('sold');
    const sold = await part(c, { status: 'sold' });
    for (let i = 0; i < 2; i++) await insertTestHistory(db, { listingId: sold, from: 'live', to: 'sold', action: 'sold', actor: 'seller' });
    const closed = await part(c, { status: 'unavailable' });
    await insertTestHistory(db, { listingId: closed, from: 'live', to: 'unavailable', action: 'unavailable', actor: 'seller' });
    const m = await periodMetrics(db, { city: c }, p7);
    expect(m.soldListings.value).toBe(1);
    expect(m.closedListings.value).toBe(1);

    const a = city('avail');
    await part(a, { quantity: '3' });
    const held = await part(a, { quantity: '2' });
    await db.update(listings).set({ heldQuantity: '2' }).where(eq(listings.id, held));
    expect((await snapshotMetrics(db, { city: a })).partsAvailable).toBe(1);
  });

  it('machines out today sums on-rent and disputed-from-on-rent bookings covering today', async () => {
    const c = city('rent');
    const { listingId } = await insertTestRentalListing({ businessId: seller.businessId, userId: seller.userId, quantity: 5, categoryId: tree.machineType.id });
    const { listingId: rentedOnly } = await insertTestRentalListing({ businessId: seller.businessId, userId: seller.userId, status: 'rented' });
    await db.update(listings).set({ city: c }).where(inArray(listings.id, [listingId, rentedOnly]));
    const base = { listingId, ownerBusinessId: seller.businessId };
    // Past its end date and still on site: counts.
    await insertTestBooking({ ...base, renterBusinessId: buyer.businessId, userId: buyer.userId, status: 'on_rent', startDate: addDays(today, -5), endDate: addDays(today, -2), machines: 2 });
    const r2 = await newBuyer();
    await insertTestBooking({ ...base, renterBusinessId: r2.businessId, userId: r2.userId, status: 'disputed', startDate: addDays(today, -1), endDate: addDays(today, 1), machines: 1 });
    const r3 = await newBuyer();
    await insertTestBooking({ ...base, renterBusinessId: r3.businessId, userId: r3.userId, status: 'confirmed', startDate: addDays(today, 1), endDate: addDays(today, 2), machines: 1 });

    const s = await snapshotMetrics(db, { city: c });
    expect(s.machinesOutToday).toBe(3);
    expect(s.machinesForRent).toBe(2);
  });
});
