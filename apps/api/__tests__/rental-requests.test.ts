import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { appSettings, businessBlocks, chatMessages, notifications, rentalBookingVersions, rentalBookings } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { addTestMember, insertTestThread } from './_helpers/test-deals.js';
import { deleteTestPincodeOffices, insertTestPincodeOffices } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 A1-1 (plan): the request and the estimate — the §6.2 refusals, the limits, the thread opened without the enquiry
// cap, forced operator choice, and the estimate's privacy rule.

const SURAT = { lat: 21.17, lng: 72.83 };
const PINCODE = '990022';

let app: FastifyInstance;
const sellers: TestSeller[] = [];
let officeIds: string[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const tomorrow = () => addDays(istToday(), 1);

async function seller(opts: { gst?: boolean } = {}) {
  const s = await createTestSeller({ gst: opts.gst ?? false, point: SURAT });
  sellers.push(s);
  return s;
}

async function rental(owner: TestSeller, o: Partial<Parameters<typeof insertTestRentalListing>[0]> = {}) {
  return (await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, point: SURAT, ...o })).listingId;
}

const body = (o: Record<string, unknown> = {}) => ({ startDate: tomorrow(), period: 'day', count: 2, machines: 1, sitePincode: PINCODE, ...o });

const request = (token: string, listingId: string, payload: Record<string, unknown> = body()) =>
  app.inject({ method: 'POST', url: `/listings/${listingId}/bookings`, headers: auth(token), payload });

async function setSetting(key: string, value: number) {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  officeIds = await insertTestPincodeOffices(PINCODE, [SURAT]);
});

afterAll(async () => {
  await db.delete(appSettings).where(eq(appSettings.key, 'enquiry_new_per_day_unverified'));
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestPincodeOffices(officeIds);
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('POST /listings/:id/bookings', () => {
  it('requests: version 1 with the server estimate, the booking card, the owner told, no enquiry card, no enquiry cap', async () => {
    const owner = await seller({ gst: true });
    const renter = await seller();
    const listingId = await rental(owner);
    // The renter is at the enquiry cap already (1 new thread today).
    const other = await rental(owner);
    await insertTestThread({ listingId: other, buyerBusinessId: renter.businessId, buyerUserId: renter.userId });
    await setSetting('enquiry_new_per_day_unverified', 1);
    try {
      const res = await request(renter.token, listingId, body({ note: 'Need it at the site by 9' }));
      expect(res.statusCode).toBe(201);
      const v = res.json().data;
      expect(v.status).toBe('requested');
      expect(v.turn).toBe('owner');
      expect(v.side).toBe('renter');
      expect(v.current).toMatchObject({ seq: 1, proposedBy: 'renter', count: 2, machines: 1, estimatePaise: 1_000_000, totalPaise: 1_000_000 });
      expect(v.current.endDate).toBe(addDays(tomorrow(), 1));

      const msgs = await db.select().from(chatMessages).where(eq(chatMessages.threadId, v.threadId));
      expect(msgs.filter((m) => m.kind === 'enquiry')).toHaveLength(0);
      expect(msgs.filter((m) => m.kind === 'booking').map((m) => m.rentalBookingId)).toEqual([v.id]);
      const told = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.rentalBookingId, v.id), eq(notifications.type, 'rental_booking_requested')));
      expect(told.length).toBeGreaterThan(0);
      expect(told.every((n) => n.businessId === owner.businessId)).toBe(true);
    } finally {
      await db.delete(appSettings).where(eq(appSettings.key, 'enquiry_new_per_day_unverified'));
    }
  });

  it('refuses a period the listing does not price, a count below its minimum and a start beyond the advance window', async () => {
    const owner = await seller({ gst: true });
    const renter = await seller();
    const listingId = await rental(owner, { minDuration: 3, minDurationPeriod: 'day' });
    expect((await request(renter.token, listingId, body({ period: 'hour', count: 4 }))).json().code).toBe('RENTAL_PERIOD_NOT_OFFERED');
    const below = await request(renter.token, listingId, body({ count: 2 }));
    expect([below.statusCode, below.json().code]).toEqual([400, 'BELOW_MINIMUM']);
    const far = await request(renter.token, listingId, body({ count: 3, startDate: addDays(istToday(), 181) }));
    expect([far.statusCode, far.json().code]).toEqual([400, 'RENTAL_DATES_INVALID']);
  });

  it('refuses dates already fully confirmed', async () => {
    const owner = await seller({ gst: true });
    const first = await seller();
    const renter = await seller();
    const listingId = await rental(owner);
    await insertTestBooking({
      listingId,
      renterBusinessId: first.businessId,
      ownerBusinessId: owner.businessId,
      userId: first.userId,
      status: 'confirmed',
      startDate: addDays(tomorrow(), 1),
    });
    const res = await request(renter.token, listingId);
    expect([res.statusCode, res.json().code]).toEqual([409, 'RENTAL_DATES_TAKEN']);
  });

  it('refuses the own listing, an owner without GST, a blocked pair and a viewer', async () => {
    const owner = await seller({ gst: true });
    const renter = await seller();
    const listingId = await rental(owner);
    expect((await request(owner.token, listingId)).json().code).toBe('OWN_LISTING');

    const noGst = await seller();
    const { id: noGstListing } = await insertTestListing(db, {
      businessId: noGst.businessId,
      userId: noGst.userId,
      kind: 'machine_rental',
      status: 'live',
      title: 'No GST excavator',
      categoryId: null,
      quantity: '1',
      point: SURAT,
      rental: { rateDayPaise: 500_000 },
    });
    const ng = await request(renter.token, noGstListing);
    expect([ng.statusCode, ng.json().code]).toEqual([403, 'RENTAL_NEEDS_GST']);

    const blocked = await seller();
    await db.insert(businessBlocks).values({ blockerBusinessId: owner.businessId, blockedBusinessId: blocked.businessId, createdByUserId: owner.userId });
    const bl = await request(blocked.token, listingId);
    expect([bl.statusCode, bl.json().code]).toEqual([403, 'BUSINESS_BLOCKED']);

    const viewer = await addTestMember(renter.businessId, 'viewer');
    const vw = await request(viewer.token, listingId);
    expect([vw.statusCode, vw.json().code]).toEqual([403, 'VIEWER_READ_ONLY']);
    expect(await db.select().from(rentalBookings).where(eq(rentalBookings.listingId, listingId))).toHaveLength(0);
  });

  it('limits: a 4th open request (unverified) → 409, a 6th of the day → 429, a second open request in a thread → 409', async () => {
    const owner = await seller({ gst: true });
    const renter = await seller();
    const listings = [await rental(owner), await rental(owner), await rental(owner), await rental(owner)];
    for (const l of listings.slice(0, 3)) expect((await request(renter.token, l)).statusCode).toBe(201);
    const fourth = await request(renter.token, listings[3]!);
    expect([fourth.statusCode, fourth.json().code]).toEqual([409, 'RENTAL_OPEN_LIMIT']);

    const busy = await seller();
    const one = listings[0]!;
    for (let i = 0; i < 5; i++) {
      await insertTestBooking({
        listingId: one,
        renterBusinessId: busy.businessId,
        ownerBusinessId: owner.businessId,
        userId: busy.userId,
        status: 'withdrawn',
        startDate: tomorrow(),
      });
    }
    const sixth = await request(busy.token, listings[1]!);
    expect([sixth.statusCode, sixth.json().code]).toEqual([429, 'RENTAL_DAILY_LIMIT']);

    const twice = await seller();
    expect((await request(twice.token, one)).statusCode).toBe(201);
    const again = await request(twice.token, one, body({ startDate: addDays(tomorrow(), 5) }));
    expect([again.statusCode, again.json().code]).toEqual([409, 'RENTAL_REQUEST_OPEN']);
  });

  it('forces the operator for an `included` listing whatever the client sends', async () => {
    const owner = await seller({ gst: true });
    const renter = await seller();
    const listingId = await rental(owner, { operator: 'included' });
    const res = await request(renter.token, listingId, body({ withOperator: false }));
    expect(res.statusCode).toBe(201);
    expect(res.json().data.current.withOperator).toBe(true);
    const [row] = await db.select().from(rentalBookingVersions).where(eq(rentalBookingVersions.bookingId, res.json().data.id));
    expect(row!.withOperator).toBe(true);
  });
});

describe('POST /rentals/estimate', () => {
  it('answers a guest with the amounts and the radius warning, never a distance', async () => {
    const owner = await seller({ gst: true });
    const listingId = await rental(owner, { serviceRadiusKm: 60 });
    const res = await app.inject({
      method: 'POST',
      url: '/rentals/estimate',
      headers: { 'x-install-id': '3d6f0a4e-7c1b-4f0e-9a51-2b7c8d9e0f12' },
      payload: { listingId, startDate: tomorrow(), period: 'day', count: 3, machines: 1, sitePincode: PINCODE },
    });
    expect(res.statusCode).toBe(200);
    const e = res.json().data;
    expect(e).toMatchObject({ totalPaise: 1_500_000, free: true, minimumMet: true, beyondServiceRadius: false });
    expect(JSON.stringify(e)).not.toMatch(/distance/i);
  });
});

