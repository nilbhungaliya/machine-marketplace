import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm';
import type { AdminRentalBookingDetail, AdminRentalBookingList, RentalBookingStatus } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { rentalBookings } from '../../db/schema.js';
import { adminText } from '../../lib/admin-text.js';
import { AppError } from '../../lib/errors.js';
import { runTx, type TxApp } from '../../lib/tx-effects.js';
import { writeAudit } from '../audit.service.js';
import { adminRowsQuery, buildAdminRentalDetail, ownerBiz, renterBiz, toAdminRentalRow } from './admin-view.js';
import { writeBookingStatus } from './booking-write.js';
import { lockListingForRental, lockRentalBooking, type RentalBookingRow } from './locks.js';
import { syncRentalStatus } from './status-sync.js';

/**
 * Admin rental bookings (M14 spec §15, R15, §13.2; plan A3-4; follows F8 `part-requests/admin.service.ts` and F6
 * `deal-admin.service.ts`). Roles `operations` and `support` (the route checks). Reads: the list with filters and the
 * detail (`admin-view.ts`). The one write, **admin cancel**, follows §6.7's lock order — listing `FOR UPDATE` →
 * booking `FOR NO KEY UPDATE` → thread (the line) — goes through `writeBookingStatus('admin_cancel')`, frees the
 * calendar (`syncRentalStatus`), tells both sides and writes `audit_log` in its transaction.
 */

type Conn = Db | Tx;

export interface AdminRentalQuery {
  status?: RentalBookingStatus;
  /** Start date on or after / on or before (`YYYY-MM-DD`, IST calendar dates). */
  from?: string;
  to?: string;
  /** Renter or owner. */
  businessId?: string;
  listingId?: string;
  /** A booking ref (`700001` or `#700001`), else a business name or the listing title. */
  q?: string;
  page: number;
  pageSize: 25 | 50 | 100;
}

const bookingNotFound = (): AppError => new AppError('Booking not found', 404, 'RENTAL_BOOKING_NOT_FOUND');

function searchWhere(q: string): SQL | null {
  const s = q.trim();
  if (!s) return null;
  const ref = /^#?(\d{1,15})$/.exec(s);
  if (ref) return eq(rentalBookings.ref, Number(ref[1]));
  const like = `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return or(ilike(renterBiz.tradeName, like), ilike(ownerBiz.tradeName, like), ilike(rentalBookings.listingTitle, like))!;
}

/** `GET /admin/rental-bookings` (§15): newest change first, paged 25 / 50 / 100. */
export async function listAdminRentalBookings(conn: Conn, q: AdminRentalQuery): Promise<AdminRentalBookingList> {
  const where: SQL[] = [];
  if (q.status) where.push(eq(rentalBookings.status, q.status));
  if (q.from) where.push(gte(rentalBookings.startDate, q.from));
  if (q.to) where.push(lte(rentalBookings.startDate, q.to));
  if (q.businessId) where.push(or(eq(rentalBookings.renterBusinessId, q.businessId), eq(rentalBookings.ownerBusinessId, q.businessId))!);
  if (q.listingId) where.push(eq(rentalBookings.listingId, q.listingId));
  const search = q.q ? searchWhere(q.q) : null;
  if (search) where.push(search);
  const cond = where.length ? and(...where) : undefined;

  const page = Math.max(1, Math.floor(q.page));
  const rows = await adminRowsQuery(conn)
    .where(cond)
    .orderBy(desc(rentalBookings.updatedAt), desc(rentalBookings.id))
    .limit(q.pageSize)
    .offset((page - 1) * q.pageSize);
  const [t] = await conn
    .select({ n: count() })
    .from(rentalBookings)
    .innerJoin(renterBiz, eq(renterBiz.id, rentalBookings.renterBusinessId))
    .innerJoin(ownerBiz, eq(ownerBiz.id, rentalBookings.ownerBusinessId))
    .where(cond);
  return { rows: rows.map(toAdminRentalRow), total: Number(t?.n ?? 0), page, pageSize: q.pageSize };
}

/** `GET /admin/rental-bookings/:id` (§15). `404 RENTAL_BOOKING_NOT_FOUND`. */
export async function getAdminRentalBooking(conn: Conn, id: string): Promise<AdminRentalBookingDetail> {
  const [b] = await conn.select().from(rentalBookings).where(eq(rentalBookings.id, id));
  if (!b) throw bookingNotFound();
  return buildAdminRentalDetail(conn, b);
}

const audited = (b: RentalBookingRow) => ({ status: b.status, cancelReason: b.cancelReason, cancelledBySide: b.cancelledBySide });

/**
 * `POST /admin/rental-bookings/:id/cancel { reason }` (§6.1 admin cancel, R15): `requested` / `countered` /
 * `confirmed` only (`409 RENTAL_TRANSITION_NOT_ALLOWED` otherwise: once on site only the dispute path settles a
 * booking). Reason 3–500 (`adminText`), kept in the audit row only (never shown to the parties). The booking ends
 * `cancelled` (`admin`, by `admin`), both sides get `rental_booking_cancelled`, the calendar is freed and the listing's
 * `rented` status follows (`syncRentalStatus`). Audit `rental_booking.cancel` with before / after. Returns the detail.
 */
export async function adminCancelBooking(
  app: TxApp,
  admin: { adminId: string },
  id: string,
  input: { reason: string },
): Promise<AdminRentalBookingDetail> {
  const reason = adminText(input.reason);
  await runTx(app, async (tx) => {
    const [seen] = await tx.select({ listingId: rentalBookings.listingId }).from(rentalBookings).where(eq(rentalBookings.id, id));
    if (!seen) throw bookingNotFound();
    const listing = await lockListingForRental(tx, seen.listingId);
    const b = await lockRentalBooking(tx, id);
    if (!b) throw bookingNotFound();
    const after = await writeBookingStatus(
      tx,
      b,
      'admin_cancel',
      { side: 'admin', adminId: admin.adminId },
      { cancelReason: 'admin' },
      { notify: [{ to: 'both', type: 'rental_booking_cancelled' }] },
    );
    await syncRentalStatus(tx, listing);
    await writeAudit(tx, {
      adminId: admin.adminId,
      action: 'rental_booking.cancel',
      entityType: 'rental_booking',
      entityId: id,
      before: audited(b),
      after: { ...audited(after), reason },
    });
  });
  return getAdminRentalBooking(app.db, id);
}
