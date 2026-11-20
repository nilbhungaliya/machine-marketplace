import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import type { CountOnlyResult, SearchFilters, SearchPage } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { listings } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { refreshListingSearch } from '../src/services/discovery/search-text.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestRedisKeys } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBlock, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 A2-2 (spec §10, R13, §5.7): "Free on" keeps rentals with a machine free on every day of the range (bookings and
// blocks count), lets a rental `rented` today through when it's free then (ranked with the available ones), and the
// count endpoint agrees with the search total.

let app: FastifyInstance;
let catalog: TestCatalog;
let owner: TestSeller;
let renter: TestSeller;
const L: Record<string, string> = {};

const today = istToday();
const d = (n: number) => addDays(today, n);
const range = { from: d(5), to: d(8) };

const rental = async (name: string, quantity: number, minutesAgo: number) => {
  const { listingId } = await insertTestRentalListing({
    businessId: owner.businessId,
    userId: owner.userId,
    quantity,
    categoryId: catalog.machineTypeId,
    title: `Free on excavator ${name}`,
  });
  await db.update(listings).set({ refreshedAt: sql`now() - make_interval(mins => ${minutesAgo}::int)` }).where(eq(listings.id, listingId));
  L[name] = listingId;
  return listingId;
};
const book = (listingId: string, o: Omit<Parameters<typeof insertTestBooking>[0], 'listingId' | 'renterBusinessId' | 'ownerBusinessId' | 'userId'>) =>
  insertTestBooking({ listingId, renterBusinessId: renter.businessId, ownerBusinessId: owner.businessId, userId: renter.userId, ...o });

const filters = (extra: SearchFilters = {}): SearchFilters => ({ kinds: ['machine_rental'], categoryId: catalog.categoryId, ...extra });
async function S(extra: SearchFilters = {}) {
  return app.inject({ method: 'POST', url: '/discover/search', payload: { filters: filters(extra), sort: 'newest' } });
}
const ids = (page: SearchPage) => page.items.map((c) => c.id);

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  owner = await createTestSeller({ gst: true, machineCategoryId: catalog.categoryId });
  renter = await createTestSeller({ machineCategoryId: catalog.categoryId });

  // One machine booked on day 2 of the range: dropped.
  await book(await rental('bookedOne', 1, 50), { status: 'confirmed', startDate: d(6), endDate: d(6) });
  // Two machines, one booked across the range: stays.
  await book(await rental('halfTwo', 2, 40), { status: 'confirmed', startDate: d(4), endDate: d(9) });
  // A block on day 3: dropped.
  await insertTestBlock({ listingId: await rental('blocked', 1, 30), userId: owner.userId, startDate: d(7), endDate: d(7) });
  // Out today, back before the range: `rented` now, free then. The newest of all.
  const rentedNow = await rental('rentedNow', 1, 10);
  await book(rentedNow, { status: 'on_rent', startDate: d(-1), endDate: d(1), onSiteAt: new Date(`${d(-1)}T06:30:00Z`) });
  await db.update(listings).set({ status: 'rented' }).where(eq(listings.id, rentedNow));
  // An open request holds nothing: stays.
  await book(await rental('requested', 1, 20), { status: 'requested', startDate: d(5), endDate: d(8) });

  await refreshListingSearch(db, Object.values(L));
});

afterAll(async () => {
  await deleteTestBusinesses([owner?.businessId, renter?.businessId].filter(Boolean) as string[]);
  await deleteTestSellerExtras([owner, renter].filter(Boolean));
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('Free on', () => {
  it('keeps rentals free on every day of the range, bookings and blocks counted', async () => {
    const all = await S();
    expect(all.statusCode, all.body).toBe(200);
    // Without dates the rented one ranks below every available rental.
    expect(ids(all.json().data)).toEqual([L.requested, L.blocked, L.halfTwo, L.bookedOne, L.rentedNow]);

    const res = await S({ rentalDates: range });
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json().data as SearchPage;
    // Free on the dates: the rented-today rental passes and ranks with the available ones (newest first).
    expect(ids(page)).toEqual([L.rentedNow, L.requested, L.halfTwo]);
    expect(page.total).toBe(3);

    const count = await app.inject({ method: 'POST', url: '/discover/search/count', payload: { filters: filters({ rentalDates: range }) } });
    expect(count.statusCode, count.body).toBe(200);
    expect((count.json().data as CountOnlyResult).total).toBe(page.total);
  });

  it('refuses a range starting before today or longer than 90 days', async () => {
    const past = await S({ rentalDates: { from: d(-1), to: d(2) } });
    expect(past.statusCode).toBe(400);
    expect(past.json().code).toBe('RENTAL_DATES_INVALID');
    const long = await S({ rentalDates: { from: d(1), to: d(91) } });
    expect(long.json().code).toBe('RENTAL_DATES_INVALID');
    const ok = await S({ rentalDates: { from: d(1), to: d(90) } });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});
