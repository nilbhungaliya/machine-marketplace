import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { chatThreads, rentalBookingEvents } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestPincodeOffices, insertTestPincodeOffices } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 A1-5 (plan): a confirmed booking counts as the thread's deal for share-my-number (R9): an open request alone
// doesn't; both ticks after the confirmation reveal the numbers (a `contact_shared` event on the booking) and the
// reveal outlasts a cancel. The thread's messages carry the booking card; the inbox shows the "deal" pill.

const SURAT = { lat: 21.17, lng: 72.83 };
const PINCODE = '990024';

let app: FastifyInstance;
const sellers: TestSeller[] = [];
let officeIds: string[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function seller(gst = false) {
  const s = await createTestSeller({ gst, point: SURAT });
  sellers.push(s);
  return s;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  officeIds = await insertTestPincodeOffices(PINCODE, [SURAT]);
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestPincodeOffices(officeIds);
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('share my number with a rental booking', () => {
  it('needs a confirmed booking, reveals on both ticks, stays revealed after a cancel; card and pill in the thread', async () => {
    const owner = await seller(true);
    const renter = await seller();
    const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, point: SURAT });
    const req = await app.inject({
      method: 'POST',
      url: `/listings/${listingId}/bookings`,
      headers: auth(renter.token),
      payload: { startDate: addDays(istToday(), 3), period: 'day', count: 1, machines: 1, sitePincode: PINCODE },
    });
    const { id, threadId } = req.json().data as { id: string; threadId: string };
    const share = (s: TestSeller) => app.inject({ method: 'POST', url: `/threads/${threadId}/share-contact`, headers: auth(s.token), payload: {} });

    const early = await share(renter);
    expect([early.statusCode, early.json().code]).toEqual([409, 'NO_DEAL_IN_THREAD']);

    const msgs = (await app.inject({ method: 'GET', url: `/threads/${threadId}/messages`, headers: auth(owner.token) })).json().data;
    const card = msgs.find((m: { kind: string }) => m.kind === 'booking');
    expect(card.booking).toMatchObject({ id, status: 'requested', turn: 'owner', current: { seq: 1 } });

    expect((await app.inject({ method: 'POST', url: `/rental-bookings/${id}/confirm`, headers: auth(owner.token), payload: { versionSeq: 1 } })).statusCode).toBe(200);
    const detail = (await app.inject({ method: 'GET', url: `/threads/${threadId}`, headers: auth(renter.token) })).json().data;
    expect(detail.contact.canTick).toBe(true);
    expect(detail.bookings).toEqual([expect.objectContaining({ id, status: 'confirmed' })]);
    const inbox = (await app.inject({ method: 'GET', url: '/threads', headers: auth(renter.token) })).json().data;
    expect(inbox.items.find((t: { threadId: string }) => t.threadId === threadId).pill).toBe('deal');

    expect((await share(renter)).json().data.revealed).toBe(false);
    const both = await share(owner);
    expect(both.json().data.revealed).toBe(true);
    expect(both.json().data.number).toBe(renter.phone);
    const events = await db
      .select()
      .from(rentalBookingEvents)
      .where(and(eq(rentalBookingEvents.bookingId, id), eq(rentalBookingEvents.code, 'contact_shared')));
    expect(events).toHaveLength(1);

    expect((await app.inject({ method: 'POST', url: `/rental-bookings/${id}/cancel`, headers: auth(renter.token), payload: { reason: 'plans_changed' } })).statusCode).toBe(200);
    const [t] = await db.select({ at: chatThreads.contactUnlockedAt }).from(chatThreads).where(eq(chatThreads.id, threadId));
    expect(t!.at).not.toBeNull();
    const after = (await app.inject({ method: 'GET', url: `/threads/${threadId}`, headers: auth(owner.token) })).json().data;
    expect(after.contact).toMatchObject({ revealed: true, number: renter.phone });
  });
});
