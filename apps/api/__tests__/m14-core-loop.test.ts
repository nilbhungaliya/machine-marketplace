import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { LANGUAGES, type NotificationType } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, businesses, dealDisputes, dealReviews, listings, notifications, rentalBlocks, rentalBookings, users } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { renderNotification } from '../src/services/notifications/render.js';
import { runRentalAutoComplete, runRentalStatusSync } from '../src/services/rentals/rental-jobs.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestPincodeOffices, deleteTestRedisKeys, insertTestPincodeOffices } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// Batch I-1 (M14 plan): the cross-lane cases no single lane could write. The core loop through the API (request →
// owner's change → accept → reveal → a second renter refused for 2 machines, booked for 1 → both on site → `rented` →
// returned with a different final → `live` → confirmed → reviews on the owner's public list; the second overruns into a
// third booking → one clash notice → returned → problem → resumed → auto-complete), then the races of §6.7 / §7.2: pause
// vs accept, admin remove vs confirm, block vs confirm for the last machine, the status job vs on site, and an owner's
// suspension during an open request. Every notification renders without the number planted in the note, the site
// address, the change message, the final note and the trade names, and without an amount.

const SURAT = { lat: 21.17, lng: 72.83 };
const PINCODE = '990027';
const PLANTED = '9876543210';
const PLANTED_DEVANAGARI = '९८७६५४३२१०';

let app: FastifyInstance;
let officeIds: string[] = [];
let support: { id: string; token: string };
let moderator: { id: string; token: string };
const businessesUsed: TestSeller[] = [];

const today = istToday();
const d = (n: number) => addDays(today, n);
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

type Res = Awaited<ReturnType<FastifyInstance['inject']>>;
const call = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object): Promise<Res> =>
  app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : method === 'POST' ? { payload: {} } : {}) });
async function ok(res: Promise<Res>, status = 200): Promise<Record<string, unknown> & { id: string }> {
  const r = await res;
  if (r.statusCode !== status) throw new Error(`expected ${status}, got ${r.statusCode} ${r.body}`);
  return r.json().data;
}

async function business(opts: { gst?: boolean; tradeName?: string } = {}): Promise<TestSeller> {
  const s = await createTestSeller({ gst: opts.gst ?? false, point: SURAT });
  businessesUsed.push(s);
  if (opts.tradeName) await db.update(businesses).set({ tradeName: opts.tradeName }).where(eq(businesses.id, s.businessId));
  return s;
}
const rental = async (owner: TestSeller, quantity = 1) =>
  (await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity, point: SURAT, title: 'Rental excavator 20 t' })).listingId;
const book = (listingId: string, owner: TestSeller, renter: TestSeller, o: Partial<Parameters<typeof insertTestBooking>[0]>) =>
  insertTestBooking({ listingId, renterBusinessId: renter.businessId, ownerBusinessId: owner.businessId, userId: renter.userId, startDate: d(1), ...o });

const bookingRow = async (id: string) => (await db.select().from(rentalBookings).where(eq(rentalBookings.id, id)))[0]!;
const listingStatus = async (id: string) => (await db.select({ s: listings.status }).from(listings).where(eq(listings.id, id)))[0]!.s;
/** Notification rows of a type on a booking, by recipient business. */
const told = async (bookingId: string, type: NotificationType) =>
  (
    await db
      .select({ businessId: notifications.businessId })
      .from(notifications)
      .where(and(eq(notifications.rentalBookingId, bookingId), eq(notifications.type, type)))
  ).map((r) => r.businessId);

const requestBody = (o: Record<string, unknown> = {}) => ({ startDate: d(1), period: 'day', count: 3, machines: 1, sitePincode: PINCODE, ...o });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  officeIds = await insertTestPincodeOffices(PINCODE, [SURAT]);
  support = await createTestAdmin('support');
  moderator = await createTestAdmin('moderator');
});

afterAll(async () => {
  const adminIds = [support?.id, moderator?.id].filter(Boolean) as string[];
  if (adminIds.length) await db.delete(auditLog).where(inArray(auditLog.adminId, adminIds));
  await deleteTestBusinesses(businessesUsed.map((s) => s.businessId));
  await deleteTestSellerExtras(businessesUsed);
  await deleteTestPincodeOffices(officeIds);
  await deleteTestAdmins(adminIds);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  expect(await countM14Rows()).toEqual(Object.fromEntries(Object.keys(await countM14Rows()).map((k) => [k, 0])));
  await app?.close();
});

describe('the core loop end to end (M14 close-out)', () => {
  let owner: TestSeller;
  let renter1: TestSeller;
  let renter2: TestSeller;
  let renter3: TestSeller;

  beforeAll(async () => {
    owner = await business({ gst: true, tradeName: `Shah Cranes ${PLANTED}` });
    renter1 = await business({ tradeName: `Patel Builders call ${PLANTED}` });
    renter2 = await business();
    renter3 = await business();
  });

  it('request → change → accept → reveal → second renter → on site → rented → returned → completed → reviews; overrun → clash → problem → resumed → auto-complete', async () => {
    const listingId = await rental(owner, 2);

    // Renter 1 asks for 3 days of 1 machine from tomorrow, with a number in the note and the site address.
    const a = await ok(
      call(renter1.token, 'POST', `/listings/${listingId}/bookings`, requestBody({
        siteAddress: `Plot 12, GIDC, call ${PLANTED}`,
        note: `Urgent, ring ${PLANTED_DEVANAGARI}`,
      })),
      201,
    );
    expect(a).toMatchObject({ status: 'requested', turn: 'owner', current: { seq: 1, totalPaise: 1_500_000 } });
    const threadId = a.threadId as string;

    // The owner proposes one more day at a total of its own; the renter accepts → confirmed at that total.
    const changed = await ok(call(owner.token, 'POST', `/rental-bookings/${a.id}/change`, {
      versionSeq: 1, startDate: d(1), period: 'day', count: 4, machines: 1, totalPaise: 1_800_000, message: `Ring ${PLANTED}`,
    }));
    expect(changed).toMatchObject({ status: 'countered', turn: 'renter', current: { seq: 2, estimatePaise: 2_000_000, totalPaise: 1_800_000 } });
    expect(JSON.stringify(changed)).not.toContain(PLANTED);
    const accepted = await ok(call(renter1.token, 'POST', `/rental-bookings/${a.id}/accept`, { versionSeq: 2 }));
    expect(accepted).toMatchObject({ status: 'confirmed' });
    expect((await bookingRow(a.id)).agreedTotalPaise).toBe(1_800_000);

    // Both tick "Share my number": revealed.
    expect((await ok(call(renter1.token, 'POST', `/threads/${threadId}/share-contact`))).revealed).toBe(false);
    const shared = await ok(call(owner.token, 'POST', `/threads/${threadId}/share-contact`));
    expect([shared.revealed, shared.number]).toEqual([true, renter1.phone]);

    // Renter 2: 2 machines over the confirmed dates → refused; 1 machine → requested, and the owner confirms.
    const full = await call(renter2.token, 'POST', `/listings/${listingId}/bookings`, requestBody({ count: 2, machines: 2 }));
    expect([full.statusCode, full.json().code]).toEqual([409, 'RENTAL_DATES_TAKEN']);
    const b = await ok(call(renter2.token, 'POST', `/listings/${listingId}/bookings`, requestBody({ count: 2, machines: 1 })), 201);
    expect((await ok(call(owner.token, 'POST', `/rental-bookings/${b.id}/confirm`, { versionSeq: 1 }))).status).toBe('confirmed');
    expect(await listingStatus(listingId)).toBe('live');

    // On site the day before the start (start − 1 = today): both out today → the listing is rented.
    await ok(call(owner.token, 'POST', `/rental-bookings/${a.id}/on-site`, { hourMeter: 1200 }));
    expect(await listingStatus(listingId)).toBe('live');
    await ok(call(renter2.token, 'POST', `/rental-bookings/${b.id}/on-site`, {}));
    expect(await listingStatus(listingId)).toBe('rented');

    // The owner returns A with a different final amount: a reason is required; one machine free → live again.
    const noReason = await call(owner.token, 'POST', `/rental-bookings/${a.id}/returned`, { hourMeter: 1240, finalAmountPaise: 2_000_000 });
    expect([noReason.statusCode, noReason.json().code]).toEqual([400, 'FINAL_REASON_REQUIRED']);
    const returned = await ok(call(owner.token, 'POST', `/rental-bookings/${a.id}/returned`, {
      hourMeter: 1240, finalAmountPaise: 2_000_000, finalReason: 'extra_time', finalNote: `Extra day, ${PLANTED}`,
    }));
    expect(returned.status).toBe('returned');
    expect(await listingStatus(listingId)).toBe('live');
    const aRow = await bookingRow(a.id);
    expect([aRow.finalAmountPaise, aRow.finalAmountReason, aRow.autoCompleteAt !== null]).toEqual([2_000_000, 'extra_time', true]);

    // The renter confirms → completed; both review with the rental facets → published, on the owner's public list.
    expect((await ok(call(renter1.token, 'POST', `/rental-bookings/${a.id}/confirm-return`))).status).toBe('completed');
    await ok(call(renter1.token, 'POST', `/rental-bookings/${a.id}/review`, {
      ratings: { matched_listing: 5, communication: 4, on_time: 5 }, text: 'Good machine, on time',
    }));
    await ok(call(owner.token, 'POST', `/rental-bookings/${a.id}/review`, { ratings: { communication: 5, payment: 4, care: 4 } }));
    const reviews = await db.select().from(dealReviews).where(eq(dealReviews.rentalBookingId, a.id));
    expect(reviews).toHaveLength(2);
    expect(reviews.every((r) => r.publishedAt !== null && r.dealId === null)).toBe(true);
    expect(reviews.find((r) => r.reviewerSide === 'seller')!.rCare).toBe(4);
    const page = (await ok(app.inject({ method: 'GET', url: `/businesses/${owner.businessId}/reviews` }))) as unknown as {
      count: number;
      items: Array<{ listingTitle: string; ratings: Record<string, number> }>;
    };
    expect(page.count).toBe(1);
    expect(page.items[0]).toMatchObject({ listingTitle: 'Rental excavator 20 t', ratings: { matched_listing: 5, communication: 4, on_time: 5 } });

    // B overruns: it should have come back yesterday.
    await db
      .update(rentalBookings)
      .set({ startDate: d(-3), endDate: d(-1), onSiteAt: sql`now() - interval '3 days'` })
      .where(eq(rentalBookings.id, b.id));
    // Renter 3 books both machines from tomorrow: the overrun counts up to today only, so the confirm fits.
    const c = await ok(call(renter3.token, 'POST', `/listings/${listingId}/bookings`, requestBody({ count: 1, machines: 2 })), 201);
    expect((await ok(call(owner.token, 'POST', `/rental-bookings/${c.id}/confirm`, { versionSeq: 1 }))).status).toBe('confirmed');
    // The status job finds the clash: the owner is told once, on the overrunning booking, across runs.
    await runRentalStatusSync(app);
    await runRentalStatusSync(app);
    expect(await told(b.id, 'rental_booking_clash')).toEqual([owner.businessId]);
    expect(await told(c.id, 'rental_booking_clash')).toEqual([]);

    // Returned (the agreed total, no reason) → the renter reports a problem → support resumes it → auto-completed.
    await ok(call(owner.token, 'POST', `/rental-bookings/${b.id}/returned`, { finalAmountPaise: Number((await bookingRow(b.id)).agreedTotalPaise) }));
    const disputed = await ok(call(renter2.token, 'POST', `/rental-bookings/${b.id}/problem`, {
      category: 'hours_or_amount', description: 'The hours on the meter are wrong',
    }));
    expect(disputed.status).toBe('disputed');
    const [dispute] = await db.select().from(dealDisputes).where(eq(dealDisputes.rentalBookingId, b.id));
    await ok(app.inject({
      method: 'POST', url: `/admin/disputes/${dispute!.id}/resolve`, headers: auth(support.token),
      payload: { outcome: 'resumed', internalNote: 'Both agreed on the hours', messageToParties: null },
    }));
    const resumed = await bookingRow(b.id);
    expect([resumed.status, resumed.autoCompleteAt !== null]).toEqual(['returned', true]);
    await db.update(rentalBookings).set({ autoCompleteAt: sql`now() - interval '1 minute'` }).where(eq(rentalBookings.id, b.id));
    await runRentalAutoComplete(app);
    const done = await bookingRow(b.id);
    expect([done.status, done.completedHow]).toEqual(['completed', 'auto']);
    expect(await told(b.id, 'rental_booking_completed')).toHaveLength(2);
  });

  it('every notification of the loop: no planted number in stored params or rendered text (en / hi / gu), no amount', async () => {
    const businessIds = [owner, renter1, renter2, renter3].map((s) => s.businessId);
    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.businessId, businessIds))).map((u) => u.id);
    const rows = await db.select().from(notifications).where(inArray(notifications.userId, userIds));
    const types = new Set(rows.map((r) => r.type));
    for (const type of [
      'rental_booking_requested', 'rental_booking_changed', 'rental_booking_confirmed', 'rental_booking_on_site',
      'rental_booking_returned', 'rental_booking_completed', 'rental_booking_clash', 'rental_booking_problem',
      'rental_booking_dispute_resolved', 'review_received',
    ]) {
      expect(types.has(type as NotificationType), type).toBe(true);
    }
    for (const n of rows) {
      expect(JSON.stringify(n.params)).not.toContain(PLANTED);
      expect(JSON.stringify(n.params)).not.toContain(PLANTED_DEVANAGARI);
      for (const language of LANGUAGES) {
        const text = renderNotification(n.type, n.params as Record<string, unknown>, language, n.unreadCount);
        const all = `${text.title} ${text.body}`;
        expect(all).not.toContain(PLANTED);
        expect(all).not.toContain(PLANTED_DEVANAGARI);
        expect(all).not.toContain('₹');
      }
    }
    for (const who of [owner, renter1]) {
      const list = await ok(call(who.token, 'GET', '/notifications'));
      expect(JSON.stringify(list)).not.toContain(PLANTED);
    }
  });
});

/** Delays for the second call of a race: both orders show up across the rounds. */
const STAGGER_MS = [0, 0, 5, 15, 30];
const later = <T>(ms: number, fn: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => setTimeout(() => fn().then(resolve, reject), ms));

describe('races (§6.7, §7.2)', () => {
  let owner: TestSeller;
  let renter: TestSeller;

  beforeAll(async () => {
    owner = await business({ gst: true });
    renter = await business();
  });

  it('the owner pauses while the renter accepts a change: both land (paused takes an accept), resume lands rented', async () => {
    for (let round = 0; round < STAGGER_MS.length; round++) {
      const listingId = await rental(owner, 1);
      const b = await book(listingId, owner, renter, { status: 'countered', startDate: d(0) });
      const doAccept = () => call(renter.token, 'POST', `/rental-bookings/${b.bookingId}/accept`, { versionSeq: 1 });
      const doPause = () => call(owner.token, 'POST', `/listings/${listingId}/actions`, { action: 'pause' });
      const [acceptRes, pauseRes] =
        round % 2 === 0
          ? (await Promise.all([doPause(), later(STAGGER_MS[round]!, doAccept)])).reverse()
          : await Promise.all([doAccept(), later(STAGGER_MS[round]!, doPause)]);
      expect(acceptRes.statusCode, acceptRes.body).toBe(200);
      expect(pauseRes.statusCode, pauseRes.body).toBe(200);
      expect((await bookingRow(b.bookingId)).status).toBe('confirmed');
      expect(await listingStatus(listingId)).toBe('paused');
      // Resumed: the status write syncs with today's capacity (the machine is booked today).
      await ok(call(owner.token, 'POST', `/listings/${listingId}/actions`, { action: 'resume' }));
      expect(await listingStatus(listingId)).toBe('rented');
    }
  });

  it('an admin removes the listing while the owner confirms: never a confirmed booking on a removed listing', async () => {
    for (let round = 0; round < STAGGER_MS.length; round++) {
      const listingId = await rental(owner, 1);
      const b = await book(listingId, owner, renter, { status: 'requested' });
      const doConfirm = () => call(owner.token, 'POST', `/rental-bookings/${b.bookingId}/confirm`, { versionSeq: 1 });
      const doRemove = () =>
        app.inject({ method: 'POST', url: `/admin/listings/${listingId}/remove`, headers: auth(moderator.token), payload: { reason: 'Fraudulent listing' } });
      const [confirmRes, removeRes] =
        round % 2 === 0
          ? (await Promise.all([doRemove(), later(STAGGER_MS[round]!, doConfirm)])).reverse()
          : await Promise.all([doConfirm(), later(STAGGER_MS[round]!, doRemove)]);
      expect(removeRes.statusCode, removeRes.body).toBe(200);
      expect([200, 404, 409]).toContain(confirmRes.statusCode);
      expect(await listingStatus(listingId)).toBe('removed');
      const row = await bookingRow(b.bookingId);
      expect([row.status, row.cancelReason]).toEqual(['cancelled', 'listing_removed']);
      // Confirmed first: it was cancelled with the removal and both sides were told.
      if (confirmRes.statusCode === 200) expect((await told(b.bookingId, 'rental_booking_cancelled')).sort()).toEqual([owner.businessId, renter.businessId].sort());
    }
  });

  it('a block for the last machine racing a confirm on the same day: exactly one wins', async () => {
    for (let round = 0; round < STAGGER_MS.length; round++) {
      const listingId = await rental(owner, 1);
      const b = await book(listingId, owner, renter, { status: 'requested', startDate: d(2), count: 2 });
      const doConfirm = () => call(owner.token, 'POST', `/rental-bookings/${b.bookingId}/confirm`, { versionSeq: 1 });
      const doBlock = () =>
        call(owner.token, 'POST', `/listings/${listingId}/rental-blocks`, { startDate: d(3), endDate: d(3), machines: 1, reason: 'maintenance' });
      const [confirmRes, blockRes] =
        round % 2 === 0
          ? (await Promise.all([doBlock(), later(STAGGER_MS[round]!, doConfirm)])).reverse()
          : await Promise.all([doConfirm(), later(STAGGER_MS[round]!, doBlock)]);
      const wins = [confirmRes.statusCode === 200, blockRes.statusCode === 201];
      expect(wins.filter(Boolean), `${confirmRes.body} | ${blockRes.body}`).toHaveLength(1);
      const loser = wins[0] ? blockRes : confirmRes;
      expect([loser.statusCode, loser.json().code]).toEqual([409, 'RENTAL_DATES_TAKEN']);
      const blocks = await db.select().from(rentalBlocks).where(eq(rentalBlocks.listingId, listingId));
      expect([(await bookingRow(b.bookingId)).status, blocks.length]).toEqual(wins[0] ? ['confirmed', 0] : ['requested', 1]);
    }
  });

  it('the status job racing an on-site mark: the listing ends rented', async () => {
    for (let round = 0; round < STAGGER_MS.length; round++) {
      const listingId = await rental(owner, 1);
      // Even rounds: a booking starting today with the listing left live (the job has work too); odd: starting tomorrow.
      const b = await book(listingId, owner, renter, { status: 'confirmed', startDate: d(round % 2 === 0 ? 0 : 1), count: 2 });
      expect(await listingStatus(listingId)).toBe('live');
      const doOnSite = () => call(renter.token, 'POST', `/rental-bookings/${b.bookingId}/on-site`, {});
      const [onSite] = await Promise.all([later(STAGGER_MS[round]!, doOnSite), runRentalStatusSync(app)]);
      expect(onSite.statusCode, onSite.body).toBe(200);
      expect((await bookingRow(b.bookingId)).status).toBe('on_rent');
      expect(await listingStatus(listingId)).toBe('rented');
    }
  });

  it("the owner business's owner suspended during an open request: declined owner_inactive, the renter told", async () => {
    const owner2 = await business({ gst: true });
    const listingId = await rental(owner2, 1);
    const b = await book(listingId, owner2, renter, { status: 'requested' });
    const confirmedOne = await book(await rental(owner2, 1), owner2, renter, { status: 'confirmed' });
    await ok(app.inject({
      method: 'POST', url: `/admin/users/${owner2.userId}/suspend`, headers: auth(moderator.token), payload: { reason: 'Testing the rental loop' },
    }));
    const row = await bookingRow(b.bookingId);
    expect([row.status, row.declineReason]).toEqual(['declined', 'owner_inactive']);
    expect(await told(b.bookingId, 'rental_booking_declined')).toEqual([renter.businessId]);
    // An agreed booking continues (as F6's deals).
    expect((await bookingRow(confirmedOne.bookingId)).status).toBe('confirmed');
    // A new request to the suspended owner's machine is refused.
    const refused = await call(renter.token, 'POST', `/listings/${listingId}/bookings`, requestBody({ count: 1 }));
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
  });
});
