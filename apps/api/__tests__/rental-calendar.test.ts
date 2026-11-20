import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { RentalAvailabilityDay, RentalBlockView, RentalCalendar } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { businesses, listings, rentalBlocks } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 A2-1 (spec §7.3, §10, R5, R13): the public availability strip never says who; the owner's calendar is the
// owner's alone (404 for anyone else); blocks check capacity under the listing lock and move `rented` with today.

let app: FastifyInstance;
let catalog: TestCatalog;
let owner: TestSeller;
let renter: TestSeller;

const today = istToday();
const d = (n: number) => addDays(today, n);
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const statusOf = async (id: string) => (await db.select({ s: listings.status }).from(listings).where(eq(listings.id, id)))[0]!.s;

const rental = async (quantity = 1) =>
  (await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity, categoryId: catalog.machineTypeId })).listingId;
const book = (listingId: string, o: Omit<Parameters<typeof insertTestBooking>[0], 'listingId' | 'renterBusinessId' | 'ownerBusinessId' | 'userId'>) =>
  insertTestBooking({ listingId, renterBusinessId: renter.businessId, ownerBusinessId: owner.businessId, userId: renter.userId, ...o });
const addBlock = (listingId: string, payload: object, token = owner.token) =>
  app.inject({ method: 'POST', url: `/listings/${listingId}/rental-blocks`, headers: auth(token), payload });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  owner = await createTestSeller({ gst: true, machineCategoryId: catalog.categoryId });
  renter = await createTestSeller({ machineCategoryId: catalog.categoryId });
});

afterAll(async () => {
  await deleteTestBusinesses([owner?.businessId, renter?.businessId].filter(Boolean) as string[]);
  await deleteTestSellerExtras([owner, renter].filter(Boolean));
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('availability and the owner calendar', () => {
  it('shows full and partial days without saying who', async () => {
    const one = await rental(1);
    const three = await rental(3);
    const a = await book(one, { status: 'confirmed', startDate: d(3), endDate: d(4) });
    const b = await book(three, { status: 'confirmed', startDate: d(2), endDate: d(2) });

    const res = await app.inject({ method: 'GET', url: `/listings/${one}/availability?from=${d(0)}&to=${d(5)}` });
    expect(res.statusCode, res.body).toBe(200);
    const days = res.json().data as RentalAvailabilityDay[];
    expect(days.map((x) => x.state)).toEqual(['free', 'free', 'free', 'full', 'full', 'free']);
    expect(days[0]).toEqual({ date: d(0), state: 'free' });

    const partial = await app.inject({ method: 'GET', url: `/listings/${three}/availability` });
    expect(partial.statusCode).toBe(200);
    const strip = partial.json().data as RentalAvailabilityDay[];
    expect(strip).toHaveLength(30);
    expect(strip[2]).toEqual({ date: d(2), state: 'partial' });

    const [r] = await db.select({ name: businesses.tradeName }).from(businesses).where(eq(businesses.id, renter.businessId));
    for (const body of [res.body, partial.body]) {
      for (const secret of [a.bookingId, b.bookingId, String(a.ref), renter.businessId, r!.name ?? 'never']) {
        expect(body).not.toContain(secret);
      }
    }

    const tooLong = await app.inject({ method: 'GET', url: `/listings/${one}/availability?from=${d(0)}&to=${d(92)}` });
    expect(tooLong.json().code).toBe('RENTAL_DATES_INVALID');
  });

  it('the calendar is the owner business’s only (404 for anyone else)', async () => {
    const id = await rental(2);
    const b = await book(id, { status: 'confirmed', startDate: d(1), endDate: d(2) });
    const open = await book(id, { status: 'requested', startDate: d(5) });

    const stranger = await app.inject({ method: 'GET', url: `/listings/${id}/calendar`, headers: auth(renter.token) });
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json().code).toBe('LISTING_NOT_FOUND');

    const res = await app.inject({ method: 'GET', url: `/listings/${id}/calendar?from=${d(0)}&to=${d(6)}`, headers: auth(owner.token) });
    expect(res.statusCode, res.body).toBe(200);
    const cal = res.json().data as RentalCalendar;
    expect(cal.quantity).toBe(2);
    expect(cal.days.map((x) => x.out)).toEqual([0, 1, 1, 0, 0, 0, 0]);
    expect(cal.days[1]!.free).toBe(1);
    expect(cal.bookings.map((x) => [x.id, x.status]).sort()).toEqual([[b.bookingId, 'confirmed'], [open.bookingId, 'requested']].sort());
  });

  it('lists a machine still out past its end date on every day capacity counts it, to today', async () => {
    const id = await rental(1);
    const late = await book(id, {
      status: 'on_rent', startDate: d(-3), endDate: d(-1), onSiteAt: new Date(Date.now() - 4 * 86_400_000),
    });
    const res = await app.inject({ method: 'GET', url: `/listings/${id}/calendar?from=${d(-5)}&to=${d(1)}`, headers: auth(owner.token) });
    expect(res.statusCode, res.body).toBe(200);
    const cal = res.json().data as RentalCalendar;
    expect(cal.memberRole).toBe('owner');
    expect(cal.bookings.find((x) => x.id === late.bookingId)).toMatchObject({ spanStart: d(-4), spanEnd: today });
    expect(cal.days.find((x) => x.date === today)!.out).toBe(1);
  });
});

describe('blocks', () => {
  it('a block over a fully booked day is refused', async () => {
    const id = await rental(1);
    await book(id, { status: 'confirmed', startDate: d(4), endDate: d(5) });
    const res = await addBlock(id, { startDate: d(3), endDate: d(4), machines: 1, reason: 'maintenance' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('RENTAL_DATES_TAKEN');
    const ok = await addBlock(id, { startDate: d(6), endDate: d(7), machines: 1, reason: 'booked_outside', note: 'Site job' });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((ok.json().data as RentalBlockView).note).toBe('Site job');
    // Widening it onto the booked days is refused too.
    const widen = await app.inject({
      method: 'PATCH',
      url: `/rental-blocks/${(ok.json().data as RentalBlockView).id}`,
      headers: auth(owner.token),
      payload: { startDate: d(5) },
    });
    expect(widen.json().code).toBe('RENTAL_DATES_TAKEN');
  });

  it('a block covering today rents the listing out and its delete brings it back', async () => {
    const id = await rental(1);
    const res = await addBlock(id, { startDate: d(0), endDate: d(2), machines: 1, reason: 'booked_outside' });
    expect(res.statusCode, res.body).toBe(201);
    expect(await statusOf(id)).toBe('rented');
    const blockId = (res.json().data as RentalBlockView).id;

    const stranger = await app.inject({ method: 'DELETE', url: `/rental-blocks/${blockId}`, headers: auth(renter.token) });
    expect(stranger.statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: `/rental-blocks/${blockId}`, headers: auth(owner.token) });
    expect(del.statusCode, del.body).toBe(200);
    expect(await statusOf(id)).toBe('live');
  });

  it('two block writes racing for the last machine: one is refused', async () => {
    const id = await rental(1);
    const body = { startDate: d(10), endDate: d(12), machines: 1, reason: 'maintenance' };
    const results = await Promise.all([addBlock(id, body), addBlock(id, body)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('RENTAL_DATES_TAKEN');
    expect(await db.select().from(rentalBlocks).where(eq(rentalBlocks.listingId, id))).toHaveLength(1);
  });
});
