import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import type { AdminRentalBookingDetail, AdminRentalBookingList } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, listings, notifications, rentalBookings } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { runTx } from '../src/lib/tx-effects.js';
import { getBusinessDetail } from '../src/services/admin/business-admin.service.js';
import { adminListingDetail } from '../src/services/listings/listing-admin.service.js';
import { outToday } from '../src/services/rentals/capacity.js';
import { syncRentalStatus } from '../src/services/rentals/status-sync.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBlock, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 A3-4 (spec §15, R15, §13.2): admin rental bookings — RBAC (operations + support read and cancel, moderator 403),
// the list's filters, the detail, admin cancel (confirmed → cancelled by admin, audit, both told, capacity freed;
// on_rent → 409), and the counts on the business and listing detail.

let app: FastifyInstance;
let owner: TestSeller;
let renter: TestSeller;
let operations: { id: string; token: string };
let support: { id: string; token: string };
let moderator: { id: string; token: string };
let listingId: string;
let otherListingId: string;
let confirmed: { bookingId: string; ref: number };
let onRent: { bookingId: string; ref: number };
let requested: { bookingId: string; ref: number };

const today = istToday();
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: auth(token) });
const list = async (token: string, query: string) => (await get(token, `/admin/rental-bookings?${query}`)).json().data as AdminRentalBookingList;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  owner = await createTestSeller({ gst: true });
  renter = await createTestSeller();
  operations = await createTestAdmin('operations');
  support = await createTestAdmin('support');
  moderator = await createTestAdmin('moderator');
  ({ listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity: 1, title: 'Crawler crane' }));
  ({ listingId: otherListingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity: 1 }));
  const base = { renterBusinessId: renter.businessId, ownerBusinessId: owner.businessId, userId: renter.userId };
  confirmed = await insertTestBooking({ ...base, listingId, status: 'confirmed', startDate: today, count: 2, siteAddress: 'Plot 4, call 9876543210' });
  requested = await insertTestBooking({ ...base, listingId, status: 'requested', startDate: addDays(today, 10) });
  onRent = await insertTestBooking({ ...base, listingId: otherListingId, status: 'on_rent', startDate: addDays(today, -1) });
  await insertTestBlock({ listingId, userId: owner.userId, startDate: addDays(today, 20), endDate: addDays(today, 22) });
  await runTx(app, async (tx) => syncRentalStatus(tx, (await db.select().from(listings).where(eq(listings.id, listingId)))[0]!));
});

afterAll(async () => {
  const admins = [operations, support, moderator].filter(Boolean).map((a) => a.id);
  if (admins.length) await db.delete(auditLog).where(inArray(auditLog.adminId, admins));
  const all = [owner, renter].filter(Boolean);
  await deleteTestBusinesses(all.map((s) => s.businessId));
  await deleteTestSellerExtras(all);
  await deleteTestAdmins(admins);
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('admin rental bookings (§15)', () => {
  it('operations and support read; a moderator gets 403', async () => {
    expect((await get(operations.token, '/admin/rental-bookings')).statusCode).toBe(200);
    expect((await get(support.token, `/admin/rental-bookings/${confirmed.bookingId}`)).statusCode).toBe(200);
    expect((await get(moderator.token, '/admin/rental-bookings')).statusCode).toBe(403);
    expect((await get(moderator.token, `/admin/rental-bookings/${confirmed.bookingId}`)).statusCode).toBe(403);
    const cancel = await app.inject({
      method: 'POST',
      url: `/admin/rental-bookings/${requested.bookingId}/cancel`,
      headers: auth(moderator.token),
      payload: { reason: 'Not allowed' },
    });
    expect(cancel.statusCode).toBe(403);
  });

  it('filters by status, business, listing, date and ref; the detail has the site, versions and events', async () => {
    const byBusiness = await list(operations.token, `businessId=${renter.businessId}&pageSize=25`);
    expect(byBusiness.total).toBe(3);
    expect((await list(operations.token, `businessId=${renter.businessId}&status=on_rent`)).rows.map((r) => r.id)).toEqual([onRent.bookingId]);
    expect((await list(operations.token, `listingId=${listingId}`)).total).toBe(2);
    expect((await list(operations.token, `listingId=${listingId}&from=${addDays(today, 5)}`)).rows.map((r) => r.id)).toEqual([requested.bookingId]);
    expect((await list(operations.token, `listingId=${listingId}&to=${today}`)).rows.map((r) => r.id)).toEqual([confirmed.bookingId]);
    const byRef = await list(operations.token, `q=%23${confirmed.ref}`);
    expect(byRef.rows.map((r) => r.id)).toEqual([confirmed.bookingId]);
    expect(byRef.rows[0]).toMatchObject({ ref: confirmed.ref, listing: { id: listingId, title: 'Crawler crane' }, renter: { businessId: renter.businessId } });

    const detail = (await get(support.token, `/admin/rental-bookings/${confirmed.bookingId}`)).json().data as AdminRentalBookingDetail;
    expect(detail).toMatchObject({ id: confirmed.bookingId, status: 'confirmed', owner: { businessId: owner.businessId } });
    expect(detail.site.address).toBe('Plot 4, call 9876543210');
    expect(detail.versions).toHaveLength(1);
    expect(detail.current.seq).toBe(1);
  });

  it('cancels a confirmed booking: cancelled by admin, audit, both told, capacity freed', async () => {
    expect((await db.select().from(listings).where(eq(listings.id, listingId)))[0]!.status).toBe('rented');
    const res = await app.inject({
      method: 'POST',
      url: `/admin/rental-bookings/${confirmed.bookingId}/cancel`,
      headers: auth(operations.token),
      payload: { reason: 'Owner asked support to cancel' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as AdminRentalBookingDetail).status).toBe('cancelled');
    const row = (await db.select().from(rentalBookings).where(eq(rentalBookings.id, confirmed.bookingId)))[0]!;
    expect(row).toMatchObject({ status: 'cancelled', cancelledBySide: 'admin', cancelReason: 'admin' });
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.entityId, confirmed.bookingId), eq(auditLog.action, 'rental_booking.cancel')));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.before).toMatchObject({ status: 'confirmed' });
    expect(audit[0]!.after).toMatchObject({ status: 'cancelled', reason: 'Owner asked support to cancel' });
    const told = await db
      .select({ businessId: notifications.businessId })
      .from(notifications)
      .where(and(eq(notifications.type, 'rental_booking_cancelled'), eq(notifications.rentalBookingId, confirmed.bookingId)));
    expect(new Set(told.map((t) => t.businessId))).toEqual(new Set([owner.businessId, renter.businessId]));
    expect(await outToday(db, listingId)).toBe(0);
    expect((await db.select().from(listings).where(eq(listings.id, listingId)))[0]!.status).toBe('live');
  });

  it('refuses to cancel an on_rent booking (409)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/admin/rental-bookings/${onRent.bookingId}/cancel`,
      headers: auth(support.token),
      payload: { reason: 'Trying anyway' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('RENTAL_TRANSITION_NOT_ALLOWED');
  });

  it('counts bookings on the business detail (owner and renter) and lists them with blocks on the listing detail', async () => {
    expect((await getBusinessDetail(db, owner.businessId)).rentalBookingCount).toEqual({ asOwner: 3, asRenter: 0 });
    expect((await getBusinessDetail(db, renter.businessId)).rentalBookingCount).toEqual({ asOwner: 0, asRenter: 3 });
    const detail = await adminListingDetail(db, listingId);
    expect(detail.rental?.bookings.map((b) => b.id).sort()).toEqual([confirmed.bookingId, requested.bookingId].sort());
    expect(detail.rental?.blocks).toHaveLength(1);
  });
});
