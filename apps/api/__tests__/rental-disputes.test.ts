import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import type { AdminDisputeDetail, AdminDisputeList } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, dealDisputes, listings, notifications, rentalBookings } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { runTx } from '../src/lib/tx-effects.js';
import { outToday } from '../src/services/rentals/capacity.js';
import { reportBookingProblem } from '../src/services/rentals/rental-disputes.js';
import { syncRentalStatus } from '../src/services/rentals/status-sync.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 A3-2 (spec R12, §5.5a): a booking problem → `disputed` keeping its capacity; support resolves resumed /
// completed (final amount) / cancelled (capacity freed, no listing quantity touched), never with `stockReturned`;
// the Disputes queue, count, detail and the conversation read take booking disputes.

let app: FastifyInstance;
let owner: TestSeller;
let renter: TestSeller;
let support: { id: string; token: string };

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const asUser = (u: TestSeller) => ({ userId: u.userId, businessId: u.businessId });
const resolve = (disputeId: string, payload: object) =>
  app.inject({ method: 'POST', url: `/admin/disputes/${disputeId}/resolve`, headers: auth(support.token), payload });
const note = { internalNote: 'Checked both sides' };
const bookingRow = async (id: string) => (await db.select().from(rentalBookings).where(eq(rentalBookings.id, id)))[0]!;
const listingRow = async (id: string) => (await db.select().from(listings).where(eq(listings.id, id)))[0]!;

/** A one-machine rental listing with a booking in `status` covering today, the listing synced (rented when out). */
async function bookingOn(status: 'on_rent' | 'returned') {
  const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity: 1 });
  const b = await insertTestBooking({
    listingId,
    renterBusinessId: renter.businessId,
    ownerBusinessId: owner.businessId,
    userId: renter.userId,
    status,
    startDate: addDays(istToday(), -1),
    count: 3,
    totalPaise: 1_500_000,
  });
  await runTx(app, async (tx) => syncRentalStatus(tx, await listingRow(listingId)));
  return { listingId, ...b };
}

async function report(by: TestSeller, bookingId: string) {
  await reportBookingProblem(app, asUser(by), bookingId, { category: 'breakdown', description: 'The machine stopped on day two', photoKeys: [] });
  const [d] = await db.select().from(dealDisputes).where(eq(dealDisputes.rentalBookingId, bookingId));
  return d!;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  owner = await createTestSeller({ gst: true });
  renter = await createTestSeller();
  support = await createTestAdmin('support');
});

afterAll(async () => {
  if (support) await db.delete(auditLog).where(eq(auditLog.adminId, support.id));
  const all = [owner, renter].filter(Boolean);
  await deleteTestBusinesses(all.map((s) => s.businessId));
  await deleteTestSellerExtras(all);
  await deleteTestAdmins([support?.id].filter(Boolean) as string[]);
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('booking problems (R12)', () => {
  it('on_rent → disputed keeps capacity; queue, count, detail and the conversation read take it; resumed → on_rent', async () => {
    const b = await bookingOn('on_rent');
    expect((await listingRow(b.listingId)).status).toBe('rented');
    const before = (await app.inject({ method: 'GET', url: '/admin/disputes/count', headers: auth(support.token) })).json().data.open as number;

    const d = await report(renter, b.bookingId);
    const row = await bookingRow(b.bookingId);
    expect(row.status).toBe('disputed');
    expect(row.disputedFrom).toBe('on_rent');
    expect(d.openedBySide).toBe('buyer');
    expect(await outToday(db, b.listingId)).toBe(1);
    expect((await listingRow(b.listingId)).status).toBe('rented');
    const told = await db.select().from(notifications).where(and(eq(notifications.type, 'rental_booking_problem'), eq(notifications.rentalBookingId, b.bookingId)));
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((n) => n.businessId === owner.businessId)).toBe(true);

    expect((await app.inject({ method: 'GET', url: '/admin/disputes/count', headers: auth(support.token) })).json().data.open).toBe(before + 1);
    const list = (await app.inject({ method: 'GET', url: '/admin/disputes?status=open&pageSize=100', headers: auth(support.token) })).json().data as AdminDisputeList;
    const listed = list.rows.find((r) => r.id === d.id)!;
    expect(listed).toMatchObject({ subject: { kind: 'rental', rentalBookingId: b.bookingId }, dealId: null, dealRef: null, rentalBookingRef: b.ref, category: 'breakdown' });
    expect(listed.buyer.businessId).toBe(renter.businessId);
    const detail = (await app.inject({ method: 'GET', url: `/admin/disputes/${d.id}`, headers: auth(support.token) })).json().data as AdminDisputeDetail;
    expect(detail).toMatchObject({ deal: null, threadId: b.threadId });

    const read = await app.inject({
      method: 'POST',
      url: `/admin/threads/${b.threadId}/read`,
      headers: auth(support.token),
      payload: { reason: 'Booking problem review' },
    });
    expect(read.statusCode).toBe(200);
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.entityId, b.threadId), eq(auditLog.action, 'thread.read')));
    expect(audit[0]!.after).toMatchObject({ disputeId: d.id });

    const res = await resolve(d.id, { outcome: 'resumed', ...note });
    expect(res.statusCode).toBe(200);
    expect((await bookingRow(b.bookingId)).status).toBe('on_rent');
    expect((await bookingRow(b.bookingId)).disputedFrom).toBeNull();
  });

  it('returned → disputed by the owner → completed (support) with the final amount', async () => {
    const b = await bookingOn('returned');
    await db.update(rentalBookings).set({ finalAmountPaise: 1_700_000, finalAmountReason: 'extra_time' }).where(eq(rentalBookings.id, b.bookingId));
    const d = await report(owner, b.bookingId);
    expect(d.openedBySide).toBe('seller');
    expect((await resolve(d.id, { outcome: 'completed', ...note })).statusCode).toBe(200);
    const row = await bookingRow(b.bookingId);
    expect(row).toMatchObject({ status: 'completed', completedHow: 'support', finalAmountPaise: 1_700_000 });
    expect((await db.select().from(dealDisputes).where(eq(dealDisputes.id, d.id)))[0]).toMatchObject({ status: 'resolved', outcome: 'completed', stockReturned: null });
    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, d.id));
    expect(audit).toHaveLength(1);
  });

  it('cancelled frees the capacity and touches no listing quantity; stockReturned on a booking is 400', async () => {
    const b = await bookingOn('on_rent');
    const d = await report(owner, b.bookingId);
    const bad = await resolve(d.id, { outcome: 'cancelled', stockReturned: true, ...note });
    expect(bad.statusCode).toBe(400);
    expect((await bookingRow(b.bookingId)).status).toBe('disputed');

    expect((await resolve(d.id, { outcome: 'cancelled', ...note })).statusCode).toBe(200);
    const row = await bookingRow(b.bookingId);
    expect(row).toMatchObject({ status: 'cancelled', cancelReason: 'support_closed', cancelledBySide: 'admin' });
    const l = await listingRow(b.listingId);
    expect(Number(l.quantity)).toBe(1);
    expect(l.status).toBe('live');
    expect(await outToday(db, b.listingId)).toBe(0);
    const resolved = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.type, 'rental_booking_dispute_resolved'), eq(notifications.rentalBookingId, b.bookingId)));
    expect(resolved[0]!.n).toBeGreaterThanOrEqual(2);
  });
});
