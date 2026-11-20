import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { chatMessages, chatThreads, listings, rentalBookingEvents, rentalBookings } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { runTx } from '../src/lib/tx-effects.js';
import { suspendUser } from '../src/services/admin/user-status.service.js';
import { revokeGst } from '../src/services/admin/business-admin.service.js';
import { blockFromThread } from '../src/services/chat/block.service.js';
import { insertCardMessage, recomputeTurns } from '../src/services/chat/thread-lines.js';
import { writeBookingStatus } from '../src/services/rentals/booking-write.js';
import { estimateFor } from '../src/services/rentals/estimate.js';
import { lockListingForRental, lockRentalBooking } from '../src/services/rentals/locks.js';
import { threadAgreement } from '../src/services/rentals/thread-agreement.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestPincodeOffices, insertTestPincodeOffices } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 C0-3a (plan): the booking write helpers, the booking card, the rental system exits wired into suspension, GST
// revoke and block, the thread agreement behind the reveal, and the estimate's privacy rule.

const SURAT = { lat: 21.17, lng: 72.83 };
/** ≈ 230 km north of Surat. */
const FAR = { lat: 23.24, lng: 72.83 };
const FAR_PINCODE = '990028';

let app: FastifyInstance;
let admin: { id: string; token: string };
const sellers: TestSeller[] = [];
let officeIds: string[] = [];

const tomorrow = () => addDays(istToday(), 1);

async function pair(opts: { gst?: boolean } = {}) {
  const owner = await createTestSeller({ gst: opts.gst ?? true, point: SURAT });
  const renter = await createTestSeller({ point: SURAT });
  sellers.push(owner, renter);
  const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity: 2, point: SURAT });
  const book = (status: Parameters<typeof insertTestBooking>[0]['status'] = 'requested') =>
    insertTestBooking({
      listingId,
      renterBusinessId: renter.businessId,
      ownerBusinessId: owner.businessId,
      userId: renter.userId,
      status,
      startDate: tomorrow(),
    });
  return { owner, renter, listingId, book };
}

const bookingRow = async (id: string) => (await db.select().from(rentalBookings).where(eq(rentalBookings.id, id)))[0]!;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  admin = await createTestAdmin('super_admin');
  officeIds = await insertTestPincodeOffices(FAR_PINCODE, [FAR]);
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins([admin?.id].filter(Boolean) as string[]);
  await deleteTestPincodeOffices(officeIds);
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('writeBookingStatus', () => {
  it('refuses an illegal action and writes a legal one with its event, line and turns', async () => {
    const { owner, book } = await pair();
    const b = await book('requested');
    await runTx(app, (tx) => recomputeTurns(tx, b.threadId));
    expect((await db.select().from(chatThreads).where(eq(chatThreads.id, b.threadId)))[0]!.sellerTurn).toBe(true);

    await expect(
      runTx(app, async (tx) => writeBookingStatus(tx, (await lockRentalBooking(tx, b.bookingId))!, 'on_site', { side: 'owner', userId: owner.userId })),
    ).rejects.toMatchObject({ code: 'RENTAL_TRANSITION_NOT_ALLOWED' });

    const written = await runTx(app, async (tx) =>
      writeBookingStatus(tx, (await lockRentalBooking(tx, b.bookingId))!, 'confirm', { side: 'owner', userId: owner.userId }),
    );
    expect(written.status).toBe('confirmed');
    expect(written.version).toBe(2);
    expect(written.turn).toBeNull();
    expect(written.confirmedAt).not.toBeNull();
    const events = await db.select().from(rentalBookingEvents).where(eq(rentalBookingEvents.bookingId, b.bookingId));
    expect(events.map((e) => e.code)).toEqual(['confirmed']);
    const lines = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.threadId, b.threadId), eq(chatMessages.kind, 'system')));
    expect(lines.map((l) => l.systemCode)).toEqual(['booking_confirmed']);
    expect(lines[0]!.rentalBookingId).toBe(b.bookingId);
    const thread = (await db.select().from(chatThreads).where(eq(chatThreads.id, b.threadId)))[0]!;
    expect([thread.buyerTurn, thread.sellerTurn]).toEqual([false, false]);
  });

  it('inserts a booking card that passes the message shape check', async () => {
    const { renter, book } = await pair();
    const b = await book('requested');
    const row = await runTx(app, (tx) =>
      insertCardMessage(tx, b.threadId, { kind: 'booking', rentalBookingId: b.bookingId, senderSide: 'buyer', senderUserId: renter.userId }),
    );
    expect(row.kind).toBe('booking');
    expect(row.rentalBookingId).toBe(b.bookingId);
  });
});

describe('system exits', () => {
  it("suspending the owner business's owner declines open requests and leaves confirmed bookings", async () => {
    const { owner, book } = await pair();
    const open = await book('requested');
    const confirmed = await book('confirmed');
    await runTx(app, (tx) => suspendUser(tx, { id: admin.id, role: 'super_admin' }, owner.userId, 'Test suspension'));
    const o = await bookingRow(open.bookingId);
    expect([o.status, o.declineReason]).toEqual(['declined', 'owner_inactive']);
    expect((await bookingRow(confirmed.bookingId)).status).toBe('confirmed');
  });

  it("suspending the renter business's owner withdraws its open requests", async () => {
    const { renter, book } = await pair();
    const open = await book('countered');
    await runTx(app, (tx) => suspendUser(tx, { id: admin.id, role: 'super_admin' }, renter.userId, 'Test suspension'));
    const o = await bookingRow(open.bookingId);
    expect([o.status, o.declineReason]).toEqual(['withdrawn', 'renter_inactive']);
  });

  it('a request holding the owner’s rental listing lock is serialised with the owner’s suspension (C0 review I2)', async () => {
    const { owner, renter, listingId } = await pair();
    // `rented` (still public, future days bookable): outside the suspension's live / reserved offer pass, so only the
    // rental listing ids folded into it lock this listing.
    await db.update(listings).set({ status: 'rented' }).where(eq(listings.id, listingId));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let pid = 0;
    let requestLocked!: () => void;
    const locked = new Promise<void>((r) => (requestLocked = r));
    // The request: renter → listing FOR UPDATE, then (after the suspension is waiting) the booking insert, then commit.
    const request = db.transaction(async (tx) => {
      pid = Number((await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid);
      await lockListingForRental(tx, listingId);
      requestLocked();
      await gate;
      return insertTestBooking(
        { listingId, renterBusinessId: renter.businessId, ownerBusinessId: owner.businessId, userId: renter.userId, startDate: tomorrow() },
        tx,
      );
    });
    await locked;
    const suspension = runTx(app, (tx) => suspendUser(tx, { id: admin.id, role: 'super_admin' }, owner.userId, 'Test suspension'));
    // Wait until the suspension is blocked by the request's transaction (its listing pass), then let the request commit.
    for (let i = 0; i < 100; i++) {
      const { rows } = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`,
      );
      if (rows[0]!.n > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    release();
    const b = await request;
    await suspension;
    const row = await bookingRow(b.bookingId);
    expect([row.status, row.declineReason]).toEqual(['declined', 'owner_inactive']);
  });

  it('a GST revoke declines the owner’s open requests', async () => {
    const { owner, book } = await pair({ gst: true });
    const open = await book('requested');
    await runTx(app, (tx) => revokeGst(tx, admin.id, owner.businessId, 'Test revocation'));
    const o = await bookingRow(open.bookingId);
    expect([o.status, o.declineReason]).toEqual(['declined', 'owner_gst']);
  });

  it('a block declines open requests between the two businesses', async () => {
    const { renter, book } = await pair();
    const open = await book('requested');
    const confirmed = await book('confirmed');
    await runTx(app, (tx) => blockFromThread(tx, { userId: renter.userId, businessId: renter.businessId }, open.threadId));
    const o = await bookingRow(open.bookingId);
    expect([o.status, o.declineReason]).toEqual(['declined', 'blocked']);
    expect((await bookingRow(confirmed.bookingId)).status).toBe('confirmed');
  });
});

describe('threadAgreement', () => {
  it('is null with only an open request and the booking once confirmed', async () => {
    const { owner, book } = await pair();
    const b = await book('requested');
    expect(await threadAgreement(db, b.threadId)).toBeNull();
    await runTx(app, async (tx) =>
      writeBookingStatus(tx, (await lockRentalBooking(tx, b.bookingId))!, 'confirm', { side: 'owner', userId: owner.userId }),
    );
    expect(await threadAgreement(db, b.threadId)).toEqual({ kind: 'rental', id: b.bookingId });
  });
});

describe('estimateFor', () => {
  it('flags a site beyond the service radius and never returns a distance', async () => {
    const owner = await createTestSeller({ gst: true, point: SURAT });
    sellers.push(owner);
    const { listingId } = await insertTestRentalListing({
      businessId: owner.businessId,
      userId: owner.userId,
      quantity: 1,
      point: SURAT,
      serviceRadiusKm: 60,
    });
    const req = { listingId, startDate: tomorrow(), period: 'day' as const, count: 3, machines: 1 };
    const far = await estimateFor(db, listingId, { ...req, sitePincode: FAR_PINCODE });
    expect(far.beyondServiceRadius).toBe(true);
    expect(far.totalPaise).toBe(1_500_000);
    expect(far.free).toBe(true);
    expect(Object.keys(far).some((k) => /dist|km/i.test(k))).toBe(false);
    expect((await estimateFor(db, listingId, req)).beyondServiceRadius).toBeNull();
  });
});
