import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/index.js';
import { listings, rentalBookings } from '../../db/schema.js';
import type { CsvCell } from '../../lib/csv.js';
import { adminRentalWhere, type AdminRentalQuery } from '../rentals/admin.service.js';
import { ownerBiz, renterBiz } from '../rentals/admin-view.js';
import { istMinute, rupees } from './format.js';
import { before, enumLabel, keysetTime, nextOf, type SheetExport, upTo } from './sheet-kit.js';

/**
 * The rental bookings sheet (admin close-out §10, R12): exactly the Rental bookings list for the same filters
 * (`adminRentalWhere`, its joins). The site's city and state only: never the site address, pincode or notes.
 */
export function rentalBookingsExport(conn: Db | Tx, filters: Omit<AdminRentalQuery, 'page' | 'pageSize'>): SheetExport {
  const where = adminRentalWhere(filters);
  const header = [
    'Ref', 'Status', 'Listing ref', 'Listing title', 'Renter', 'Owner', 'Start', 'End', 'Period', 'Count', 'Machines',
    'Agreed total (INR)', 'Final amount (INR)', 'Site city', 'Site state', 'Confirmed', 'Completed', 'Cancelled',
  ];
  const time = (d: Date | null): string => (d ? istMinute(d) : '');

  return {
    header,
    filters,
    async count(asOf) {
      const [row] = await conn
        .select({ n: count() })
        .from(rentalBookings)
        .innerJoin(renterBiz, eq(renterBiz.id, rentalBookings.renterBusinessId))
        .innerJoin(ownerBiz, eq(ownerBiz.id, rentalBookings.ownerBusinessId))
        .where(and(where, upTo(sql`${rentalBookings.createdAt}`, asOf)));
      return Number(row?.n ?? 0);
    },
    async page(after, { asOf, pageSize }) {
      const rows = await conn
        .select({
          id: rentalBookings.id,
          sort_at: keysetTime(sql`${rentalBookings.createdAt}`).mapWith(String),
          b: rentalBookings,
          listingRef: listings.ref,
          renterName: renterBiz.tradeName,
          ownerName: ownerBiz.tradeName,
        })
        .from(rentalBookings)
        .innerJoin(renterBiz, eq(renterBiz.id, rentalBookings.renterBusinessId))
        .innerJoin(ownerBiz, eq(ownerBiz.id, rentalBookings.ownerBusinessId))
        .innerJoin(listings, eq(listings.id, rentalBookings.listingId))
        .where(and(where, before(sql`${rentalBookings.createdAt}`, sql`${rentalBookings.id}`, after, asOf)))
        .orderBy(desc(rentalBookings.createdAt), desc(rentalBookings.id))
        .limit(pageSize);
      return {
        rows: rows.map(({ b, listingRef, renterName, ownerName }): CsvCell[] => [
          `#${b.ref}`, enumLabel(b.status), `#${listingRef}`, b.listingTitle, renterName, ownerName, b.startDate, b.endDate,
          enumLabel(b.period), b.periodCount, b.machines, rupees(b.agreedTotalPaise), rupees(b.finalAmountPaise),
          b.siteCity, b.siteState, time(b.confirmedAt), time(b.completedAt), time(b.cancelledAt),
        ]),
        next: nextOf(rows, pageSize),
      };
    },
  };
}
