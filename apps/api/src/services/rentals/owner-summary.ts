import { sql } from 'drizzle-orm';
import type { MyListingCard, RentalBookingSummary } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { IST_TODAY } from '../../lib/ist.js';
import { capacityIntervalsSql, outToday } from './capacity.js';

type Conn = Db | Tx;

/**
 * The owner's booking lines of a rental listing (M14 plan D14, C0-3b): `ListingOwnerView.bookingSummary` (`GET
 * /listings/:id` for the owner) and `MyListingCard.rentalLine` (`GET /listings/mine`). Counts and dates only; the
 * public view gains nothing.
 */

/** Open requests, active bookings, machines out today and the next confirmed booking (start today or later). */
export async function rentalOwnerSummary(conn: Conn, listingId: string): Promise<RentalBookingSummary> {
  const { rows } = await conn.execute<{ open: number; active: number }>(sql`
    SELECT
      count(*) FILTER (WHERE status IN ('requested', 'countered'))::int AS open,
      count(*) FILTER (WHERE status IN ('confirmed', 'on_rent', 'returned', 'disputed'))::int AS active
    FROM rental_bookings WHERE listing_id = ${listingId}::uuid
  `);
  const { rows: next } = await conn.execute<{ id: string; ref: string | number; start_date: string; end_date: string; machines: number }>(sql`
    SELECT id, ref, start_date::text, end_date::text, machines::int AS machines FROM rental_bookings
    WHERE listing_id = ${listingId}::uuid AND status = 'confirmed' AND start_date >= ${IST_TODAY}
    ORDER BY start_date, ref LIMIT 1
  `);
  const n = next[0];
  return {
    openRequests: Number(rows[0]?.open ?? 0),
    activeBookings: Number(rows[0]?.active ?? 0),
    outToday: await outToday(conn, listingId),
    nextBooking: n ? { id: n.id, ref: Number(n.ref), startDate: n.start_date, endDate: n.end_date, machines: Number(n.machines) } : null,
  };
}

export type RentalCardLine = NonNullable<MyListingCard['rentalLine']>;

/** My listings' rental line per listing id (one query for the page); ids that aren't rentals are left out. */
export async function rentalCardLine(conn: Conn, listingIds: string[]): Promise<Map<string, RentalCardLine>> {
  if (listingIds.length === 0) return new Map();
  const ids = sql.join(listingIds.map((id) => sql`${id}::uuid`), sql`, `);
  const { rows } = await conn.execute<{ id: string; quantity: string | null; out_today: number; active: number }>(sql`
    SELECT l.id, l.quantity,
      (SELECT COALESCE(sum(i.machines), 0) FROM ${capacityIntervalsSql(sql`l.id`)} i WHERE ${IST_TODAY} BETWEEN i.s AND i.e)::int AS out_today,
      (SELECT count(*) FROM rental_bookings b
        WHERE b.listing_id = l.id AND b.status IN ('confirmed', 'on_rent', 'returned', 'disputed'))::int AS active
    FROM listings l
    WHERE l.id IN (${ids}) AND l.kind = 'machine_rental'
  `);
  return new Map(
    rows.map((r) => [
      r.id,
      { quantity: Math.floor(Number(r.quantity ?? 0)), outToday: Number(r.out_today), activeBookings: Number(r.active) },
    ]),
  );
}
