import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { listings, rentalBookings } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { addTestMember } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 A1-2 (plan): the proposal state machine (confirm, change, accept, decline, withdraw), the change cap, the version
// guard, the listing states of §7.2, and capacity under races (two confirms; confirm vs a quantity decrease).

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
  const book = (o: { status?: 'requested' | 'countered' | 'confirmed'; start?: number; renter?: TestSeller; machines?: number } = {}) => {
    const r = o.renter ?? renter;
    return insertTestBooking({
      listingId,
      renterBusinessId: r.businessId,
      ownerBusinessId: owner.businessId,
      userId: r.userId,
      status: o.status ?? 'requested',
      startDate: day(o.start ?? 2),
      count: 2,
      machines: o.machines ?? 1,
    });
  };
  return { owner, renter, listingId, book };
}

const post = (token: string, id: string, step: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `/rental-bookings/${id}/${step}`, headers: auth(token), payload });

const change = (token: string, id: string, versionSeq: number, o: Record<string, unknown> = {}) =>
  post(token, id, 'change', { versionSeq, startDate: day(3), period: 'day', count: 2, machines: 1, ...o });

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

describe('proposals', () => {
  it('owner confirm → confirmed at the version total; a renter can’t confirm', async () => {
    const { owner, renter, book } = await setup();
    const b = await book();
    const bad = await post(renter.token, b.bookingId, 'confirm', { versionSeq: 1 });
    expect([bad.statusCode, bad.json().code]).toEqual([409, 'RENTAL_TRANSITION_NOT_ALLOWED']);
    const res = await post(owner.token, b.bookingId, 'confirm', { versionSeq: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'confirmed', agreedTotalPaise: 1_000_000, side: 'owner' });
  });

  it('owner change with its own total → countered; renter accepts → confirmed at the owner’s total; stale seq → 409', async () => {
    const { owner, renter, book } = await setup();
    const b = await book();
    const ch = await change(owner.token, b.bookingId, 1, { totalPaise: 900_000, message: 'Discount for 2 days' });
    expect(ch.statusCode).toBe(200);
    expect(ch.json().data).toMatchObject({ status: 'countered', turn: 'renter', changeCount: 1 });
    expect(ch.json().data.current).toMatchObject({ seq: 2, proposedBy: 'owner', estimatePaise: 1_000_000, totalPaise: 900_000 });
    const stale = await post(renter.token, b.bookingId, 'accept', { versionSeq: 1 });
    expect([stale.statusCode, stale.json().code]).toEqual([409, 'RENTAL_BOOKING_STALE']);
    const ok = await post(renter.token, b.bookingId, 'accept', { versionSeq: 2 });
    expect(ok.json().data).toMatchObject({ status: 'confirmed', agreedTotalPaise: 900_000 });
  });

  it('a renter’s changed request goes back to the owner at the estimate; the 6th change is refused', async () => {
    const { owner, renter, book } = await setup();
    const b = await book();
    let seq = 1;
    for (let i = 0; i < 5; i++) {
      const by = i % 2 === 0 ? owner : renter;
      const res = await change(by.token, b.bookingId, seq, { count: 2 + (i % 2), totalPaise: by === owner ? 800_000 : undefined });
      expect(res.statusCode).toBe(200);
      seq++;
      if (by === renter) expect(res.json().data).toMatchObject({ status: 'requested', turn: 'owner' });
      if (by === renter) expect(res.json().data.current.totalPaise).toBe(res.json().data.current.estimatePaise);
    }
    // Five changes made (owner, renter, owner, renter, owner): the renter's turn; a sixth is refused.
    const sixth = await change(renter.token, b.bookingId, seq);
    expect([sixth.statusCode, sixth.json().code]).toEqual([409, 'RENTAL_CHANGE_LIMIT']);
  });

  it('withdraw from countered; a viewer is refused', async () => {
    const { owner, renter, book } = await setup();
    const b = await book({ status: 'countered' });
    const viewer = await addTestMember(renter.businessId, 'viewer');
    const vw = await post(viewer.token, b.bookingId, 'withdraw');
    expect([vw.statusCode, vw.json().code]).toEqual([403, 'VIEWER_READ_ONLY']);
    const ownerViewer = await addTestMember(owner.businessId, 'viewer');
    expect((await post(ownerViewer.token, b.bookingId, 'confirm', { versionSeq: 1 })).statusCode).toBe(403);
    const res = await post(renter.token, b.bookingId, 'withdraw');
    expect(res.json().data.status).toBe('withdrawn');
  });

  it('confirm on a hidden listing → 409 LISTING_NOT_BOOKABLE; on a paused one → confirmed', async () => {
    const { owner, listingId, book } = await setup();
    const b = await book();
    await db.update(listings).set({ status: 'hidden' }).where(eq(listings.id, listingId));
    const hidden = await post(owner.token, b.bookingId, 'confirm', { versionSeq: 1 });
    expect([hidden.statusCode, hidden.json().code]).toEqual([409, 'LISTING_NOT_BOOKABLE']);
    await db.update(listings).set({ status: 'paused' }).where(eq(listings.id, listingId));
    expect((await post(owner.token, b.bookingId, 'confirm', { versionSeq: 1 })).json().data.status).toBe('confirmed');
  });
});

describe('capacity under races', () => {
  it('two concurrent confirms of overlapping requests on a 1-machine listing: one confirmed, one 409', async () => {
    const { owner, book } = await setup(1);
    const other = await seller();
    const a = await book({ start: 2 });
    const b = await book({ start: 3, renter: other });
    const [ra, rb] = await Promise.all([
      post(owner.token, a.bookingId, 'confirm', { versionSeq: 1 }),
      post(owner.token, b.bookingId, 'confirm', { versionSeq: 1 }),
    ]);
    const codes = [ra, rb].map((r) => (r.statusCode === 200 ? r.json().data.status : r.json().code)).sort();
    expect(codes).toEqual(['RENTAL_DATES_TAKEN', 'confirmed']);
  });

  it('a confirm racing a quantity decrease never leaves more machines confirmed than the listing has', async () => {
    for (let round = 0; round < 3; round++) {
      const { owner, listingId, book } = await setup(2);
      const other = await seller();
      await book({ status: 'confirmed', start: 2, renter: other });
      const y = await book({ start: 2 });
      const [confirm, patch] = await Promise.all([
        post(owner.token, y.bookingId, 'confirm', { versionSeq: 1 }),
        app.inject({ method: 'PATCH', url: `/listings/${listingId}`, headers: auth(owner.token), payload: { quantity: '1' } }),
      ]);
      // Exactly one wins: either the confirm (then the decrease is refused) or the decrease (then the confirm is).
      expect([confirm.statusCode, patch.statusCode].filter((s) => s === 200)).toHaveLength(1);
      const [l] = await db.select({ quantity: listings.quantity }).from(listings).where(eq(listings.id, listingId));
      const confirmed = await db
        .select({ machines: rentalBookings.machines })
        .from(rentalBookings)
        .where(and(eq(rentalBookings.listingId, listingId), inArray(rentalBookings.status, ['confirmed'])));
      expect(confirmed.reduce((s, r) => s + r.machines, 0)).toBeLessThanOrEqual(Number(l!.quantity));
      if (confirm.statusCode !== 200) expect(confirm.json().code).toBe('RENTAL_DATES_TAKEN');
      else expect(patch.json().code).toBe('RENTAL_QUANTITY_BOOKED');
      expect((await row(y.bookingId)).status).toBe(confirm.statusCode === 200 ? 'confirmed' : 'requested');
    }
  });
});
