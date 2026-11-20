import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { listings, rentalBookings } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 A1-3 (plan): on site (the day before at the earliest, either side), returned (final amount reason, hour meters,
// the auto-complete window), confirm return, cancel (only before on site; frees the dates and the listing), notes
// (version guard, advance ≤ agreed, a Devanagari number masked for the other side).

const SURAT = { lat: 21.17, lng: 72.83 };

let app: FastifyInstance;
const sellers: TestSeller[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const day = (n: number) => addDays(istToday(), n);

async function seller(gst = false) {
  const s = await createTestSeller({ gst, point: SURAT });
  sellers.push(s);
  return s;
}

async function setup(quantity = 1) {
  const owner = await seller(true);
  const renter = await seller();
  const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity, point: SURAT });
  const book = (o: { status?: 'requested' | 'confirmed' | 'on_rent' | 'returned'; start?: number; renter?: TestSeller } = {}) => {
    const r = o.renter ?? renter;
    return insertTestBooking({
      listingId,
      renterBusinessId: r.businessId,
      ownerBusinessId: owner.businessId,
      userId: r.userId,
      status: o.status ?? 'confirmed',
      startDate: day(o.start ?? 1),
      count: 2,
    });
  };
  return { owner, renter, listingId, book };
}

const post = (token: string, id: string, step: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `/rental-bookings/${id}/${step}`, headers: auth(token), payload });
const row = async (id: string) => (await db.select().from(rentalBookings).where(eq(rentalBookings.id, id)))[0]!;

beforeAll(async () => {
  app = await buildApp({ logger: false });
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('on site', () => {
  it('allows the day before the start, refuses two days before; the renter can mark it', async () => {
    const { owner, renter, book } = await setup(2);
    const early = await book({ start: 2 });
    const tooEarly = await post(owner.token, early.bookingId, 'on-site');
    expect([tooEarly.statusCode, tooEarly.json().code]).toEqual([409, 'RENTAL_TOO_EARLY']);

    const b = await book({ start: 1 });
    const res = await post(renter.token, b.bookingId, 'on-site', { hourMeter: 120 });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'on_rent', onSite: { bySide: 'renter', hourMeter: 120, photoCount: 0 } });
  });
});

describe('returned and confirm return', () => {
  it('needs a reason for a different final amount and a closing meter not below the opening; sets the auto-complete window', async () => {
    const { owner, renter, book } = await setup();
    const b = await book({ status: 'on_rent' });
    await db.update(rentalBookings).set({ hourMeterStart: 500 }).where(eq(rentalBookings.id, b.bookingId));

    const noReason = await post(owner.token, b.bookingId, 'returned', { finalAmountPaise: 1_200_000 });
    expect([noReason.statusCode, noReason.json().code]).toEqual([400, 'FINAL_REASON_REQUIRED']);
    const meter = await post(owner.token, b.bookingId, 'returned', { finalAmountPaise: 1_000_000, hourMeter: 499 });
    expect([meter.statusCode, meter.json().code]).toEqual([400, 'HOUR_METER_INVALID']);
    const renterTry = await post(renter.token, b.bookingId, 'returned', { finalAmountPaise: 1_000_000 });
    expect(renterTry.json().code).toBe('RENTAL_TRANSITION_NOT_ALLOWED');

    const ok = await post(owner.token, b.bookingId, 'returned', { finalAmountPaise: 1_200_000, finalReason: 'overtime', hourMeter: 540 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ status: 'returned', finalAmountPaise: 1_200_000, finalAmountReason: 'overtime' });
    const { rows } = await db.execute<{ hours: number }>(
      sql`SELECT extract(epoch FROM (auto_complete_at - now())) / 3600 AS hours FROM rental_bookings WHERE id = ${b.bookingId}::uuid`,
    );
    expect(Number(rows[0]!.hours)).toBeGreaterThan(47.9);
    expect(Number(rows[0]!.hours)).toBeLessThanOrEqual(48);

    expect((await post(owner.token, b.bookingId, 'confirm-return')).json().code).toBe('RENTAL_TRANSITION_NOT_ALLOWED');
    const done = await post(renter.token, b.bookingId, 'confirm-return');
    expect(done.json().data).toMatchObject({ status: 'completed', completedHow: 'renter_confirmed' });
  });
});

describe('cancel', () => {
  it('is refused once on site', async () => {
    const { renter, book } = await setup();
    const b = await book({ status: 'on_rent' });
    const res = await post(renter.token, b.bookingId, 'cancel', { reason: 'plans_changed' });
    expect([res.statusCode, res.json().code]).toEqual([409, 'RENTAL_TRANSITION_NOT_ALLOWED']);
  });

  it('frees the dates (another request for them can be confirmed) and brings a rented listing back to live', async () => {
    const { owner, listingId, book } = await setup(1);
    const b = await book({ start: 0 });
    await db.update(listings).set({ status: 'rented' }).where(eq(listings.id, listingId));
    const res = await post(owner.token, b.bookingId, 'cancel', { reason: 'breakdown', note: 'Hydraulic leak' });
    expect(res.json().data).toMatchObject({ status: 'cancelled', cancelled: { bySide: 'owner', reason: 'breakdown' } });
    const [l] = await db.select({ status: listings.status }).from(listings).where(eq(listings.id, listingId));
    expect(l!.status).toBe('live');

    const next = await seller();
    const again = await book({ start: 0, renter: next, status: 'requested' });
    const confirmed = await post(owner.token, again.bookingId, 'confirm', { versionSeq: 1 });
    expect(confirmed.json().data.status).toBe('confirmed');
    expect((await row(b.bookingId)).cancelReason).toBe('breakdown');
  });
});

describe('notes', () => {
  it('guards the version, keeps the advance within the agreed total and masks a Devanagari number for the other side', async () => {
    const { owner, renter, book } = await setup();
    const b = await book();
    const patch = (token: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/rental-bookings/${b.bookingId}/notes`, headers: auth(token), payload });

    const tooMuch = await patch(renter.token, { version: 1, advancePaise: 2_000_000 });
    expect(tooMuch.statusCode).toBe(400);
    const ok = await patch(renter.token, { version: 1, advancePaise: 200_000, text: 'Call me on ९८७६५४३२१०' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.notes).toMatchObject({ advancePaise: 200_000, version: 2 });
    const stale = await patch(owner.token, { version: 1, paymentMethod: 'upi' });
    expect([stale.statusCode, stale.json().code]).toEqual([409, 'RENTAL_BOOKING_STALE']);

    const ownerView = (await app.inject({ method: 'GET', url: `/rental-bookings/${b.bookingId}`, headers: auth(owner.token) })).json().data;
    expect(ownerView.notes.text).not.toContain('९८७६५४३२१०');
    expect(ownerView.notes.text).toContain('Call me on');
  });
});
