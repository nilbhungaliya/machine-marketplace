import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import type { AdminDashboard, AdminRole } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { chatThreads, deals, industrialAreas, listings, offers, rentalBookings } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { dashboardCacheKey, getAdminDashboard } from '../src/services/admin-insights/dashboard.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { insertTestDeal, insertTestThread } from './_helpers/test-deals.js';
import { testRunId } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// Admin close-out plan A1-2 (spec §6.1, §6.3, R1, R3, R4; review focus 5): the trend and the breakdown add up to the
// tiles for the run's city, weekly buckets start on Mondays, the 60 s cache, and "Today's work" by role.

const run = testRunId();
const CITY = `Dash ${run} trend`;
const today = istToday();
const ist = (day: string, hm: string) => new Date(`${day}T${hm}:00+05:30`);

let app: FastifyInstance;
let seller: TestSeller;
const buyers: TestBusinessUser[] = [];
const adminIds: string[] = [];
const tokens = new Map<AdminRole, string>();
let areaId: string;
let otherAreaId: string;
const cacheKeys: string[] = [];

async function token(role: AdminRole): Promise<string> {
  if (!tokens.has(role)) {
    const a = await createTestAdmin(role);
    adminIds.push(a.id);
    tokens.set(role, a.token);
  }
  return tokens.get(role)!;
}

async function getDashboard(query: string, role: AdminRole = 'category_manager') {
  return app.inject({ method: 'GET', url: `/admin/dashboard?${query}`, headers: { authorization: `Bearer ${await token(role)}` } });
}

async function buyer(): Promise<TestBusinessUser> {
  const b = await createTestBusinessUser();
  buyers.push(b);
  return b;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  seller = await createTestSeller();
  const areas = await db
    .insert(industrialAreas)
    .values([
      { name: `Dash Area ${run}`, city: CITY, state: 'Gujarat' },
      { name: `Dash Other ${run}`, city: CITY, state: 'Gujarat' },
    ])
    .returning({ id: industrialAreas.id });
  areaId = areas[0]!.id;
  otherAreaId = areas[1]!.id;

  const listing = async (area: string) =>
    (
      await insertTestListing(db, {
        businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, city: CITY,
        industrialAreaId: area, quantity: '100',
      })
    ).id;
  const inArea = await listing(areaId);
  const inOther = await listing(otherAreaId);

  // Deals spread over the last 7 days and 32 days (one before a 32-day range's start, inside its first week).
  const placed: Array<[string, string, string]> = [
    [inArea, today, '10:00'],
    [inArea, addDays(today, -3), '00:05'],
    [inOther, addDays(today, -6), '23:55'],
    [inOther, addDays(today, -20), '12:00'],
    [inArea, addDays(today, -31), '00:30'],
    [inArea, addDays(today, -32), '12:00'],
  ];
  for (const [id, day, hm] of placed) {
    const d = await insertTestDeal({ listing: { id }, buyer: await buyer(), quantity: '1', pricePerUnitPaise: 125_000 });
    await db.update(deals).set({ acceptedAt: ist(day, hm) }).where(eq(deals.id, d.dealId));
    await db.update(offers).set({ createdAt: ist(day, hm) }).where(eq(offers.id, d.offerId));
    await db.update(chatThreads).set({ createdAt: ist(day, hm) }).where(eq(chatThreads.id, d.threadId));
  }
  // An enquiry with no offer, 2 days ago.
  const b = await buyer();
  const t = await insertTestThread({ listingId: inOther, buyerBusinessId: b.businessId, buyerUserId: b.userId });
  await db.update(chatThreads).set({ createdAt: ist(addDays(today, -2), '09:00') }).where(eq(chatThreads.id, t.id));

  // Two confirmed bookings on a rental machine in the city.
  const { listingId: rental } = await insertTestRentalListing({ businessId: seller.businessId, userId: seller.userId, quantity: 3 });
  await db.update(listings).set({ city: CITY, industrialAreaId: areaId, industrialAreaOther: null }).where(eq(listings.id, rental));
  for (const day of [addDays(today, -1), addDays(today, -4)]) {
    const r = await buyer();
    const bk = await insertTestBooking({
      listingId: rental, renterBusinessId: r.businessId, ownerBusinessId: seller.businessId, userId: r.userId,
      status: 'confirmed', startDate: addDays(today, 3),
    });
    await db.update(rentalBookings).set({ confirmedAt: ist(day, '15:00') }).where(eq(rentalBookings.id, bk.bookingId));
  }
});

afterAll(async () => {
  if (app?.redis && cacheKeys.length) await app.redis.del(...cacheKeys);
  await deleteTestBusinesses([seller?.businessId, ...buyers.map((b) => b.businessId)].filter(Boolean) as string[]);
  if (seller) await deleteTestSellerExtras([seller]);
  await db.delete(industrialAreas).where(inArray(industrialAreas.id, [areaId, otherAreaId].filter(Boolean)));
  await deleteTestAdmins(adminIds);
  await app?.close();
});

const sum = (d: AdminDashboard, k: 'enquiries' | 'offers' | 'deals' | 'dealValuePaise' | 'rentalBookings') =>
  d.trend.reduce((n, b) => n + b[k], 0);

describe('trend (R3, review focus 5)', () => {
  it('7-day buckets add up to the tiles for the run’s city', async () => {
    const q = { range: '7d' as const, city: CITY };
    cacheKeys.push(dashboardCacheKey(q, today));
    const res = await getDashboard(`range=7d&city=${encodeURIComponent(CITY)}`);
    expect(res.statusCode).toBe(200);
    const d = res.json().data as AdminDashboard;
    expect(d.trend).toHaveLength(7);
    expect(d.trend[0]!.bucket).toBe(addDays(today, -6));
    expect(d.metrics.deals.value).toBe(3);
    expect(d.metrics.dealValuePaise.value).toBe(375_000);
    // 3 deal threads + 1 enquiry + 2 booking threads (a booking request's thread counts, my call 4).
    expect(d.metrics.enquiries.value).toBe(6);
    expect(d.metrics.rentalBookings.value).toBe(2);
    for (const k of ['enquiries', 'offers', 'deals', 'dealValuePaise', 'rentalBookings'] as const) {
      expect(sum(d, k), k).toBe(k === 'dealValuePaise' ? d.metrics.dealValuePaise.value : d.metrics[k].value);
    }
  });

  it('a 32-day range is weekly from Mondays, a 31-day one daily; weekly buckets still add up', async () => {
    const weekly = await getAdminDashboard({ db }, { range: 'custom', from: addDays(today, -31), to: today, city: CITY }, { today });
    expect(weekly.period.granularity).toBe('week');
    for (const b of weekly.trend) expect(new Date(`${b.bucket}T00:00:00Z`).getUTCDay(), b.bucket).toBe(1);
    expect(weekly.trend[0]!.bucket <= addDays(today, -31)).toBe(true);
    expect(weekly.metrics.deals.value).toBe(5);
    expect(sum(weekly, 'deals')).toBe(5);
    expect(sum(weekly, 'dealValuePaise')).toBe(weekly.metrics.dealValuePaise.value);

    const daily = await getAdminDashboard({ db }, { range: 'custom', from: addDays(today, -30), to: today, city: CITY }, { today });
    expect(daily.period.granularity).toBe('day');
    expect(daily.trend).toHaveLength(31);
    expect(sum(daily, 'deals')).toBe(daily.metrics.deals.value);
  });

  it('refuses a custom range over 366 days', async () => {
    const res = await getDashboard(`range=custom&from=${addDays(today, -366)}&to=${today}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('DASHBOARD_RANGE_INVALID');
  });
});

describe('breakdown (plan D6, review focus 5)', () => {
  it('the area row’s deals equal the tile with that area filter', async () => {
    const byArea = await getAdminDashboard({ db }, { range: '7d', city: CITY, breakdown: 'industrial_area' }, { today });
    expect(byArea.breakdown.by).toBe('industrial_area');
    const row = byArea.breakdown.rows.find((r) => r.key === areaId)!;
    const tile = await getAdminDashboard({ db }, { range: '7d', city: CITY, industrialAreaId: areaId }, { today });
    expect(row.label).toBe(`Dash Area ${run}`);
    expect(row.deals).toBe(tile.metrics.deals.value);
    expect(row.deals).toBe(2);
    expect(row.dealValuePaise).toBe(tile.metrics.dealValuePaise.value);
    expect(row.activeListings).toBe(tile.snapshot.activeListings);
    expect(byArea.breakdown.rows.reduce((n, r) => n + r.deals, 0)).toBe(byArea.metrics.deals.value);

    const byCity = await getAdminDashboard({ db }, { range: '7d', city: CITY }, { today });
    expect(byCity.breakdown.rows).toHaveLength(1);
    expect(byCity.breakdown.rows[0]).toMatchObject({ label: CITY, deals: byCity.metrics.deals.value, dealsPrevious: byCity.metrics.deals.previous });
  });
});

describe('cache (R4)', () => {
  it('serves a repeat within 60 s, a fresh answer for another filter and after expiry', async () => {
    const redis = app.redis!;
    const q = { range: '30d' as const, city: CITY };
    const key = dashboardCacheKey(q, today);
    const otherKey = dashboardCacheKey({ ...q, industrialAreaId: areaId }, today);
    cacheKeys.push(key, otherKey);
    const first = await getAdminDashboard({ db, redis }, q, { today });
    const again = await getAdminDashboard({ db, redis }, { ...q, city: ` ${CITY.toUpperCase()} ` }, { today });
    expect(again.generatedAt).toBe(first.generatedAt);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    const other = await getAdminDashboard({ db, redis }, { ...q, industrialAreaId: areaId }, { today });
    expect(other.generatedAt).not.toBe(first.generatedAt);

    // Expire the entry (as 60 s would): the next read computes again.
    await redis.pexpire(key, 1);
    await new Promise((r) => setTimeout(r, 20));
    const fresh = await getAdminDashboard({ db, redis }, q, { today });
    expect(fresh.generatedAt).not.toBe(first.generatedAt);
  });
});

describe('Today’s work (R1)', () => {
  it('shows only the queues the role can open', async () => {
    const work = async (role: AdminRole) => {
      const res = await app.inject({ method: 'GET', url: '/admin/dashboard/work', headers: { authorization: `Bearer ${await token(role)}` } });
      expect(res.statusCode).toBe(200);
      return res.json().data as Record<string, number>;
    };
    expect(await work('category_manager')).toEqual({});
    const mod = await work('moderator');
    expect(Object.keys(mod).sort()).toEqual(['listingsReported', 'listingsToReview', 'reportsOpen', 'signalsOpen']);
    const all = await work('super_admin');
    expect(Object.keys(all).sort()).toEqual([
      'disputesOpen', 'listingsReported', 'listingsToReview', 'reportsOpen', 'signalsOpen', 'verificationWaiting',
    ]);
    for (const v of Object.values(all)) expect(v).toBeGreaterThanOrEqual(0);
  });
});
