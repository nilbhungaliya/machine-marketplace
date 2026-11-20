import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { NotificationType } from '@mpm/shared-types';
import { and, eq, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { listings, notifications, rentalBookingEvents, rentalBookings } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import {
  runRentalAutoComplete,
  runRentalBookingExpiry,
  runRentalReminders,
  runRentalStatusSync,
} from '../src/services/rentals/rental-jobs.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 A2-3 (spec §9, §6.4, R4, R6, R7; review focus #2, #5): each job's main transition, once across re-runs and two
// runs at once; the status sync flips with the IST date and fixes listings left `rented` by the retired manual action;
// an overrun clash tells the owner once.

let app: FastifyInstance;
let catalog: TestCatalog;
let owner: TestSeller;
let renter: TestSeller;

const today = istToday();
const d = (n: number) => addDays(today, n);
const istNoon = (n: number) => new Date(`${d(n)}T06:30:00Z`);

const rental = async (quantity = 1) =>
  (await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity, categoryId: catalog.machineTypeId })).listingId;
const book = (listingId: string, o: Omit<Parameters<typeof insertTestBooking>[0], 'listingId' | 'renterBusinessId' | 'ownerBusinessId' | 'userId'>) =>
  insertTestBooking({ listingId, renterBusinessId: renter.businessId, ownerBusinessId: owner.businessId, userId: renter.userId, ...o });
const bookingOf = async (id: string) => (await db.select().from(rentalBookings).where(eq(rentalBookings.id, id)))[0]!;
const statusOf = async (id: string) => (await db.select({ s: listings.status }).from(listings).where(eq(listings.id, id)))[0]!.s;
const events = async (bookingId: string, code: string) =>
  (await db.select().from(rentalBookingEvents).where(and(eq(rentalBookingEvents.bookingId, bookingId), sql`${rentalBookingEvents.code} = ${code}`))).length;
/** Notification rows of a type for a booking, by recipient business. */
const told = async (bookingId: string, type: NotificationType) => {
  const rows = await db
    .select({ businessId: notifications.businessId })
    .from(notifications)
    .where(and(eq(notifications.rentalBookingId, bookingId), eq(notifications.type, type)));
  return rows.map((r) => (r.businessId === owner.businessId ? 'owner' : r.businessId === renter.businessId ? 'renter' : 'other')).sort();
};

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

describe('rental-booking-expiry', () => {
  it('expires a request past its reply window or its start date, once under two runs at once', async () => {
    const unanswered = await book(await rental(), { status: 'requested', startDate: d(3) });
    await db.update(rentalBookings).set({ replyDueAt: sql`now() - interval '1 minute'` }).where(eq(rentalBookings.id, unanswered.bookingId));
    const started = await book(await rental(), { status: 'countered', startDate: d(-1) });
    const fresh = await book(await rental(), { status: 'requested', startDate: d(3) });

    await Promise.all([runRentalBookingExpiry(app), runRentalBookingExpiry(app)]);
    await runRentalBookingExpiry(app);

    for (const b of [unanswered, started]) {
      const row = await bookingOf(b.bookingId);
      expect([row.status, row.turn]).toEqual(['expired', null]);
      expect(await events(b.bookingId, 'expired')).toBe(1);
      expect(await told(b.bookingId, 'rental_booking_expired')).toEqual(['owner', 'renter']);
    }
    expect((await bookingOf(fresh.bookingId)).status).toBe('requested');
  });
});

describe('rental-booking-auto-complete', () => {
  it('completes a returned booking past its window, once under two runs at once', async () => {
    const due = await book(await rental(), { status: 'returned', startDate: d(-4), endDate: d(-2), onSiteAt: istNoon(-4) });
    await db.update(rentalBookings).set({ autoCompleteAt: sql`now() - interval '1 minute'` }).where(eq(rentalBookings.id, due.bookingId));
    const waiting = await book(await rental(), { status: 'returned', startDate: d(-4), endDate: d(-2), onSiteAt: istNoon(-4) });

    await Promise.all([runRentalAutoComplete(app), runRentalAutoComplete(app)]);
    await runRentalAutoComplete(app);

    const row = await bookingOf(due.bookingId);
    expect([row.status, row.completedHow]).toEqual(['completed', 'auto']);
    expect(row.completedAt).not.toBeNull();
    expect(await events(due.bookingId, 'auto_completed')).toBe(1);
    expect(await told(due.bookingId, 'rental_booking_completed')).toEqual(['owner', 'renter']);
    expect((await bookingOf(waiting.bookingId)).status).toBe('returned');
  });
});

describe('rental-booking-reminders', () => {
  it('sends each reminder once across runs, in the IST daytime only', async () => {
    const tomorrow = await book(await rental(), { status: 'confirmed', startDate: d(1), endDate: d(2) });
    const dueBack = await book(await rental(), { status: 'on_rent', startDate: d(-2), endDate: d(0), onSiteAt: istNoon(-2) });
    const overdue = await book(await rental(), { status: 'on_rent', startDate: d(-3), endDate: d(-1), onSiteAt: istNoon(-3) });
    const notStarted = await book(await rental(), { status: 'confirmed', startDate: d(-1), endDate: d(1) });

    // 00:30 IST: nothing goes out.
    expect(await runRentalReminders(app, { now: new Date(`${d(-1)}T19:00:00Z`) })).toBe(0);
    expect(await told(tomorrow.bookingId, 'rental_booking_starts_tomorrow')).toEqual([]);

    await runRentalReminders(app, { now: istNoon(0) });
    await runRentalReminders(app, { now: istNoon(0) });

    expect(await told(tomorrow.bookingId, 'rental_booking_starts_tomorrow')).toEqual(['owner', 'renter']);
    expect(await told(dueBack.bookingId, 'rental_booking_due_back')).toEqual(['owner', 'renter']);
    expect(await told(overdue.bookingId, 'rental_booking_overdue')).toEqual(['owner']);
    expect(await told(notStarted.bookingId, 'rental_booking_not_started')).toEqual(['owner', 'renter']);
    expect((await bookingOf(tomorrow.bookingId)).startRemindedAt).not.toBeNull();
    expect((await bookingOf(dueBack.bookingId)).dueRemindedAt).not.toBeNull();
    expect((await bookingOf(overdue.bookingId)).overdueRemindedAt).not.toBeNull();
    expect((await bookingOf(notStarted.bookingId)).notStartedRemindedAt).not.toBeNull();
    // The next day's reminder for the same booking isn't sent again either (each column stamps once).
    await db.update(rentalBookings).set({ endDate: d(-1) }).where(eq(rentalBookings.id, dueBack.bookingId));
    await runRentalReminders(app, { now: istNoon(0) });
    expect(await told(dueBack.bookingId, 'rental_booking_due_back')).toEqual(['owner', 'renter']);
  });
});

describe('rental-status-sync', () => {
  it('flips live → rented when a booking starts today, back once it has ended, and fixes a stray rented', async () => {
    const id = await rental(1);
    const b = await book(id, { status: 'confirmed', startDate: d(0), endDate: d(1) });
    expect(await statusOf(id)).toBe('live');
    await runRentalStatusSync(app);
    expect(await statusOf(id)).toBe('rented');

    await db.update(rentalBookings).set({ startDate: d(-3), endDate: d(-1) }).where(eq(rentalBookings.id, b.bookingId));
    await runRentalStatusSync(app);
    expect(await statusOf(id)).toBe('live');

    // Left `rented` by the retired manual "Mark rented", nothing out today.
    const stray = await rental(1);
    await db.update(listings).set({ status: 'rented' }).where(eq(listings.id, stray));
    await runRentalStatusSync(app);
    expect(await statusOf(stray)).toBe('live');
  });

  // `clashWithFor` counts an overrun out through tomorrow, so a booking starting tomorrow already collides.
  it('tells the owner once about an overrun colliding with the next booking (starting tomorrow)', async () => {
    const id = await rental(1);
    const late = await book(id, { status: 'on_rent', startDate: d(-3), endDate: d(-1), onSiteAt: istNoon(-3) });
    const next = await book(id, { status: 'confirmed', startDate: d(1), endDate: d(3) });

    await runRentalStatusSync(app);
    await runRentalStatusSync(app);

    expect(await told(late.bookingId, 'rental_booking_clash')).toEqual(['owner']);
    const [row] = await db
      .select({ key: notifications.dedupeKey })
      .from(notifications)
      .where(and(eq(notifications.rentalBookingId, late.bookingId), eq(notifications.type, 'rental_booking_clash')));
    expect(row!.key).toBe(`clash:${late.bookingId}:${next.bookingId}`);
    expect(await statusOf(id)).toBe('rented');
  });
});
