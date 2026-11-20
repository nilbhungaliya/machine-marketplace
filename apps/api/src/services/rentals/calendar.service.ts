import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { RentalBlockView, RentalBookingStatus, RentalCalendar } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings, rentalBlocks } from '../../db/schema.js';
import { IST_TODAY } from '../../lib/ist.js';
import { publicText } from '../chat/chat-view.js';
import { listingNotFound, type ListingRow } from '../listings/locks.js';
import { outByDay, readWindow } from './availability.service.js';
import { machinesOf } from './capacity.js';

// The owner's calendar (M14 spec §7.3; plan A2-1): per day machines out and free, the bookings covering the window
// (agreed ones and open requests, which hold nothing, §5.7) with the renter's name, and the owner's blocks.

type Conn = Db | Tx;

/** Statuses the calendar shows: active bookings plus open requests (flagged by their status). */
const CALENDAR_STATUSES: readonly RentalBookingStatus[] = ['requested', 'countered', 'confirmed', 'on_rent', 'returned', 'disputed'];

/**
 * The owner business's `machine_rental` listing (any status), read for a member of it; anyone else gets `404
 * LISTING_NOT_FOUND` (never 403, so ids don't leak).
 */
export async function ownerRentalListing(conn: Conn, user: { businessId: string | null }, listingId: string): Promise<ListingRow> {
  if (!user.businessId) throw listingNotFound();
  const [row] = await conn
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.kind, 'machine_rental'), eq(listings.businessId, user.businessId)));
  if (!row) throw listingNotFound();
  return row;
}

export function toBlockView(b: typeof rentalBlocks.$inferSelect): RentalBlockView {
  return { id: b.id, startDate: b.startDate, endDate: b.endDate, machines: b.machines, reason: b.reason, note: b.note };
}

/** `GET /listings/:id/calendar?from=&to=` (owner members, viewers read; window as availability, default 30 days). */
export async function getRentalCalendar(
  conn: Conn,
  user: { businessId: string | null },
  listingId: string,
  q: { from?: string; to?: string },
): Promise<RentalCalendar> {
  const listing = await ownerRentalListing(conn, user, listingId);
  const { from, to } = readWindow(q);
  const quantity = machinesOf(listing);
  const days = (await outByDay(conn, listing.id, from, to)).map(({ date, out }) => ({ date, out, free: Math.max(0, quantity - out) }));

  // A booking's span as capacity counts it (§5.7): from the earlier of its start and on-site day; a machine still out
  // (`on_rent`, or disputed from it) to today.
  const statuses = sql.join(CALENDAR_STATUSES.map((s) => sql`${s}`), sql`, `);
  const { rows } = await conn.execute<{
    id: string;
    ref: string | number;
    status: RentalBookingStatus;
    start_date: string;
    end_date: string;
    machines: number;
    renter_name: string | null;
  }>(sql`
    SELECT b.id, b.ref, b.status, b.start_date::text, b.end_date::text, b.machines, rb.trade_name AS renter_name
    FROM rental_bookings b JOIN businesses rb ON rb.id = b.renter_business_id
    WHERE b.listing_id = ${listing.id}::uuid
      AND b.status::text IN (${statuses})
      AND LEAST(b.start_date, COALESCE((b.on_site_at AT TIME ZONE 'Asia/Kolkata')::date, b.start_date)) <= ${to}::date
      AND (CASE WHEN b.status = 'on_rent' OR (b.status = 'disputed' AND b.disputed_from = 'on_rent')
             THEN GREATEST(b.end_date, ${IST_TODAY}) ELSE b.end_date END) >= ${from}::date
    ORDER BY b.start_date, b.ref
  `);

  const blocks = await conn
    .select()
    .from(rentalBlocks)
    .where(and(eq(rentalBlocks.listingId, listing.id), lte(rentalBlocks.startDate, to), gte(rentalBlocks.endDate, from)))
    .orderBy(asc(rentalBlocks.startDate), asc(rentalBlocks.id));

  return {
    listingId: listing.id,
    quantity,
    days,
    bookings: rows.map((r) => ({
      id: r.id,
      ref: Number(r.ref),
      status: r.status,
      startDate: r.start_date,
      endDate: r.end_date,
      machines: Number(r.machines),
      renterName: publicText(r.renter_name) ?? '',
    })),
    blocks: blocks.map(toBlockView),
  };
}
