import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { appSettings, listings, rentalBookings } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { runTx } from '../src/lib/tx-effects.js';
import { applySystemTransition } from '../src/services/listings/listing-lifecycle.service.js';
import { runListingExpiry } from '../src/services/listings/listing-jobs.service.js';
import { lockListingOnly } from '../src/services/listings/locks.js';
import { syncRentalStatus } from '../src/services/rentals/status-sync.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { createTestMachineUnit, createTestSeller, deleteTestSellerExtras, deleteTestUnits, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 C0-3b (plan, review focus #2, spec §7.1–§7.2): a rental's `rented` follows today's capacity through every path
// back on view, and listing writes meet bookings as the listing-state table says.

let app: FastifyInstance;
let catalog: TestCatalog;
let machineUnit: { id: string; key: string };
let admin: { id: string; token: string };
let owner: TestSeller;
let renter: TestSeller;
const sellers: TestSeller[] = [];

const today = istToday();
const d = (n: number) => addDays(today, n);
const istNoon = (n: number) => new Date(`${d(n)}T06:30:00Z`);
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const act = (id: string, action: string) =>
  app.inject({ method: 'POST', url: `/listings/${id}/actions`, headers: auth(owner.token), payload: { action } });
const adminPost = (id: string, path: string, payload: object = {}) =>
  app.inject({ method: 'POST', url: `/admin/listings/${id}/${path}`, headers: auth(admin.token), payload });
const statusOf = async (id: string) => (await db.select({ s: listings.status }).from(listings).where(eq(listings.id, id)))[0]!.s;
const versionOf = async (id: string) => (await db.select({ v: listings.version }).from(listings).where(eq(listings.id, id)))[0]!.v;
const bookingOf = async (id: string) => (await db.select().from(rentalBookings).where(eq(rentalBookings.id, id)))[0]!;

const rental = (quantity = 1) =>
  insertTestRentalListing({
    businessId: owner.businessId,
    userId: owner.userId,
    quantity,
    categoryId: catalog.machineTypeId,
  }).then(async ({ listingId }) => {
    await db.update(listings).set({ unitId: machineUnit.id }).where(eq(listings.id, listingId));
    return listingId;
  });
const book = (listingId: string, o: Omit<Parameters<typeof insertTestBooking>[0], 'listingId' | 'renterBusinessId' | 'ownerBusinessId' | 'userId'>) =>
  insertTestBooking({ listingId, renterBusinessId: renter.businessId, ownerBusinessId: owner.businessId, userId: renter.userId, ...o });
/** A booking with the machine out today (on site yesterday, due back tomorrow). */
const outNow = (listingId: string, machines = 1) =>
  book(listingId, { status: 'on_rent', startDate: d(-1), endDate: d(1), machines, onSiteAt: istNoon(-1) });
const sync = (listingId: string) => runTx(app, async (tx) => syncRentalStatus(tx, await lockListingOnly(tx, listingId)));

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  machineUnit = await createTestMachineUnit();
  admin = await createTestAdmin('moderator');
  owner = await createTestSeller({ gst: true, machineCategoryId: catalog.categoryId });
  renter = await createTestSeller({ machineCategoryId: catalog.categoryId });
  sellers.push(owner, renter);
  await db.insert(appSettings).values({ key: 'listing_review_first_n', value: 0 }).onConflictDoUpdate({ target: appSettings.key, set: { value: 0 } });
});

afterAll(async () => {
  await db.delete(appSettings).where(eq(appSettings.key, 'listing_review_first_n'));
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins([admin?.id].filter(Boolean) as string[]);
  await deleteTestCatalog(catalog.categoryId);
  if (machineUnit) await deleteTestUnits([machineUnit.id]);
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('syncRentalStatus and the paths back on view', () => {
  it('rents out when nothing is free today and back when a machine returns', async () => {
    const id = await rental(1);
    const b = await outNow(id);
    expect(await sync(id)).toBe('rent_out');
    expect(await statusOf(id)).toBe('rented');
    expect(await sync(id)).toBeNull();
    await db.update(rentalBookings).set({ status: 'returned', returnedAt: new Date() }).where(eq(rentalBookings.id, b.bookingId));
    expect(await sync(id)).toBe('rent_back');
    expect(await statusOf(id)).toBe('live');
  });

  it('pause then resume while all out lands rented', async () => {
    const id = await rental(1);
    await outNow(id);
    await sync(id);
    expect((await act(id, 'pause')).statusCode).toBe(200);
    expect(await statusOf(id)).toBe('paused');
    const res = await act(id, 'resume');
    expect(res.statusCode).toBe(200);
    expect(await statusOf(id)).toBe('rented');
  });

  it('admin hide then unhide while all out lands rented', async () => {
    const id = await rental(1);
    await outNow(id);
    expect((await adminPost(id, 'hide', { reason: 'Test hide reason' })).statusCode).toBe(200);
    expect(await statusOf(id)).toBe('hidden');
    expect((await adminPost(id, 'unhide')).statusCode).toBe(200);
    expect(await statusOf(id)).toBe('rented');
  });

  it('back to review from rented, then approve, lands rented', async () => {
    const id = await rental(1);
    await outNow(id);
    await sync(id);
    await runTx(app, async (tx) =>
      applySystemTransition(tx, await lockListingOnly(tx, id), 'back_to_review', { reviewReasons: ['edited_after_report'] }),
    );
    expect(await statusOf(id)).toBe('pending_review');
    expect((await adminPost(id, 'approve', { version: await versionOf(id) })).statusCode).toBe(200);
    expect(await statusOf(id)).toBe('rented');
  });
});

describe('listing writes that meet bookings', () => {
  it('a seller remove is refused with a confirmed booking and cancels an open request otherwise', async () => {
    const blocked = await rental(1);
    await book(blocked, { status: 'confirmed', startDate: d(3) });
    const refused = await act(blocked, 'remove');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('LISTING_HAS_OPEN_BOOKINGS');
    expect(await statusOf(blocked)).toBe('live');

    const id = await rental(1);
    const open = await book(id, { status: 'requested', startDate: d(3) });
    expect((await act(id, 'remove')).statusCode).toBe(200);
    expect(await statusOf(id)).toBe('removed');
    const b = await bookingOf(open.bookingId);
    expect([b.status, b.cancelReason, b.cancelledBySide]).toEqual(['cancelled', 'listing_removed', 'system']);
  });

  it('an admin remove cancels a confirmed booking and keeps one on rent', async () => {
    const id = await rental(2);
    const confirmed = await book(id, { status: 'confirmed', startDate: d(3) });
    const onRent = await outNow(id);
    expect((await adminPost(id, 'remove', { reason: 'Test removal reason' })).statusCode).toBe(200);
    expect(await statusOf(id)).toBe('removed');
    expect((await bookingOf(confirmed.bookingId)).status).toBe('cancelled');
    expect((await bookingOf(onRent.bookingId)).status).toBe('on_rent');
  });

  it('a quantity decrease below what is booked is refused', async () => {
    const id = await rental(3);
    await book(id, { status: 'confirmed', startDate: d(1), endDate: d(2), machines: 2 });
    const res = await app.inject({ method: 'PATCH', url: `/listings/${id}`, headers: auth(owner.token), payload: { quantity: '1' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('RENTAL_QUANTITY_BOOKED');
    const ok = await app.inject({ method: 'PATCH', url: `/listings/${id}`, headers: auth(owner.token), payload: { quantity: '2' } });
    expect(ok.statusCode).toBe(200);
  });

  it('the expiry job skips a rental with a confirmed booking and expires one without', async () => {
    const booked = await rental(1);
    await book(booked, { status: 'confirmed', startDate: d(5) });
    const idle = await rental(1);
    await db
      .update(listings)
      .set({ refreshedAt: sql`now() - interval '400 days'` })
      .where(sql`${listings.id} IN (${booked}::uuid, ${idle}::uuid)`);
    await runListingExpiry(app, { businessIds: [owner.businessId] });
    expect(await statusOf(booked)).toBe('live');
    expect(await statusOf(idle)).toBe('expired');
  });
});
