import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { addTestMember } from './_helpers/test-deals.js';
import { deleteTestPincodeOffices, insertTestPincodeOffices } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 A1-4 (plan): who reads a booking (404 for anyone else), the site address rules of §8 (owner: nothing before the
// confirmation, masked until the reveal, never plain for a viewer; the renter always), the owner's whole-km distance,
// list tabs and side filters, and the Deals tab badge.

const SURAT = { lat: 21.17, lng: 72.83 };
/** ≈ 22 km north of Surat. */
const SITE = { lat: 21.37, lng: 72.83 };
const PINCODE = '990023';
const PHONE = '9876543210';

let app: FastifyInstance;
const sellers: TestSeller[] = [];
let officeIds: string[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const day = (n: number) => addDays(istToday(), n);

async function seller(gst = false) {
  const s = await createTestSeller({ gst, point: SURAT });
  sellers.push(s);
  return s;
}

const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: auth(token) });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  officeIds = await insertTestPincodeOffices(PINCODE, [SITE]);
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestPincodeOffices(officeIds);
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('GET /rental-bookings/:id', () => {
  it('404 for outsiders; the site address per reader through confirmation and the reveal; distance for the owner only', async () => {
    const owner = await seller(true);
    const renter = await seller();
    const stranger = await seller();
    const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, point: SURAT });
    const req = await app.inject({
      method: 'POST',
      url: `/listings/${listingId}/bookings`,
      headers: auth(renter.token),
      payload: { startDate: day(2), period: 'day', count: 1, machines: 1, sitePincode: PINCODE, siteAddress: `Plot 12, call ${PHONE}` },
    });
    expect(req.statusCode).toBe(201);
    const id = req.json().data.id as string;
    const threadId = req.json().data.threadId as string;
    const url = `/rental-bookings/${id}`;

    const out = await get(stranger.token, url);
    expect([out.statusCode, out.json().code]).toEqual([404, 'RENTAL_BOOKING_NOT_FOUND']);
    expect((await app.inject({ method: 'POST', url: `${url}/confirm`, headers: auth(stranger.token), payload: { versionSeq: 1 } })).statusCode).toBe(404);

    const renterViewer = await addTestMember(renter.businessId, 'viewer');
    const ownerViewer = await addTestMember(owner.businessId, 'viewer');

    let o = (await get(owner.token, url)).json().data;
    expect(o.site.address).toBeNull();
    expect(o.site.city).toBeTruthy();
    expect(Number.isInteger(o.site.distanceKm)).toBe(true);
    expect(o.site.distanceKm).toBeGreaterThanOrEqual(20);
    expect(o.site.distanceKm).toBeLessThanOrEqual(23);
    const r = (await get(renter.token, url)).json().data;
    expect(r.site.address).toBe(`Plot 12, call ${PHONE}`);
    expect(r.site.distanceKm).toBeNull();
    expect((await get(renterViewer.token, url)).json().data.site.address).not.toContain(PHONE);

    expect((await app.inject({ method: 'POST', url: `${url}/confirm`, headers: auth(owner.token), payload: { versionSeq: 1 } })).statusCode).toBe(200);
    o = (await get(owner.token, url)).json().data;
    expect(o.site.address).toContain('Plot 12');
    expect(o.site.address).not.toContain(PHONE);

    for (const s of [renter, owner]) {
      const share = await app.inject({ method: 'POST', url: `/threads/${threadId}/share-contact`, headers: auth(s.token), payload: {} });
      expect(share.statusCode).toBe(200);
    }
    expect((await get(owner.token, url)).json().data.site.address).toBe(`Plot 12, call ${PHONE}`);
    expect((await get(ownerViewer.token, url)).json().data.site.address).not.toContain(PHONE);
  });
});

describe('GET /rental-bookings and badges', () => {
  it('puts each status in its tab and side, and counts whose turn it is', async () => {
    const owner = await seller(true);
    const renter = await seller();
    const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity: 10, point: SURAT });
    const book = (status: Parameters<typeof insertTestBooking>[0]['status'], start = 5) =>
      insertTestBooking({
        listingId,
        renterBusinessId: renter.businessId,
        ownerBusinessId: owner.businessId,
        userId: renter.userId,
        status,
        startDate: day(start),
      });
    const ids: Record<string, string> = {};
    for (const s of ['requested', 'countered', 'confirmed', 'returned', 'completed', 'withdrawn', 'cancelled'] as const) {
      ids[s] = (await book(s)).bookingId;
    }

    const list = async (token: string, q: string) => (await get(token, `/rental-bookings?${q}`)).json().data;
    const active = await list(renter.token, 'tab=active&side=all');
    expect(active.items.map((i: { id: string }) => i.id).sort()).toEqual([ids.requested, ids.countered, ids.confirmed, ids.returned].sort());
    expect(active.counts).toEqual({ active: 4, completed: 1, cancelled: 2 });
    expect((await list(renter.token, 'tab=completed&side=renter')).items.map((i: { id: string }) => i.id)).toEqual([ids.completed]);
    expect((await list(renter.token, 'tab=cancelled&side=renter')).items).toHaveLength(2);
    expect((await list(renter.token, 'tab=active&side=owner')).items).toHaveLength(0);
    const ownerList = await list(owner.token, `tab=active&side=owner&listingId=${listingId}`);
    expect(ownerList.items).toHaveLength(4);
    expect(ownerList.items.find((i: { id: string }) => i.id === ids.requested).yourTurn).toBe(true);

    // Owner: the request (and nothing dated yet: the confirmed booking starts in 5 days). Renter: countered + returned.
    const badges = async (token: string) => (await get(token, '/users/me/badges')).json().data.rentalsYourTurn;
    expect(await badges(owner.token)).toBe(1);
    expect(await badges(renter.token)).toBe(2);
    expect(ownerList.yourTurn).toBe(1);
  });
});
