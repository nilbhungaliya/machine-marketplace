import { and, eq, sql } from 'drizzle-orm';
import { RENTAL_LIMITS, type RentalAvailabilityDay } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { addDays, istToday } from '../../lib/ist.js';
import { isRealDate } from '../../lib/spec-check.js';
import { listingNotFound } from '../listings/locks.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import { machinesOf, outByDaySql } from './capacity.js';

// The public availability strip (M14 spec §10, R13; plan A2-1): free / partly booked / full per IST day, never who,
// how many or which booking. Reads capacity's one definition (`outByDaySql`, §5.7).

type Conn = Db | Tx;

export function rentalDatesInvalid(field: string): ValidationError {
  return new ValidationError('Those dates are not valid', { field }, 'RENTAL_DATES_INVALID');
}

/** Whole days from `a` to `b` (`YYYY-MM-DD`), `b − a`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * A read window `[from, to]` (IST dates): `from` defaults to today, `to` to `from + 29`; both real dates, `to ≥ from`,
 * at most `RENTAL_LIMITS.availabilityMaxDays` days (`400 RENTAL_DATES_INVALID`). `clampToToday` (the public strip)
 * moves a past `from` to today, so no past window is served publicly; the owner's calendar keeps them.
 */
export function readWindow(
  q: { from?: string; to?: string },
  opts: { today?: string; clampToToday?: boolean } = {},
): { from: string; to: string } {
  const today = opts.today ?? istToday();
  let from = q.from ?? today;
  if (!isRealDate(from)) throw rentalDatesInvalid('from');
  if (opts.clampToToday && from < today) from = today;
  const to = q.to ?? addDays(from, RENTAL_LIMITS.availabilityDefaultDays - 1);
  if (!isRealDate(to)) throw rentalDatesInvalid('to');
  if (to < from || daysBetween(from, to) + 1 > RENTAL_LIMITS.availabilityMaxDays) throw rentalDatesInvalid('to');
  return { from, to };
}

/** Machines out on each day of the window: `[{ date, out }]` in date order. */
export async function outByDay(conn: Conn, listingId: string, from: string, to: string): Promise<Array<{ date: string; out: number }>> {
  const { rows } = await conn.execute<{ d: string; out: number }>(
    sql`SELECT x.d::text AS d, x.out FROM (${outByDaySql(listingId, from, to)}) x ORDER BY x.d`,
  );
  return rows.map((r) => ({ date: r.d, out: Number(r.out) }));
}

/**
 * `GET /listings/:id/availability?from=&to=` (public): a public `machine_rental` listing's days, `full` when nothing is
 * free, `partial` when some machines are out, else `free`, from today on (a past `from` is clamped to today). Any other
 * listing → `404 LISTING_NOT_FOUND`.
 */
export async function getAvailability(conn: Conn, listingId: string, q: { from?: string; to?: string }): Promise<RentalAvailabilityDay[]> {
  const [listing] = await conn
    .select({ id: listings.id, quantity: listings.quantity })
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.kind, 'machine_rental'), publicListingWhere(listings)));
  if (!listing) throw listingNotFound();
  const { from, to } = readWindow(q, { clampToToday: true });
  const quantity = machinesOf(listing);
  return (await outByDay(conn, listing.id, from, to)).map(({ date, out }) => ({
    date,
    state: out >= quantity ? 'full' : out > 0 ? 'partial' : 'free',
  }));
}
