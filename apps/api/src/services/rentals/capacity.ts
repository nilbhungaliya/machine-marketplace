import { sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../../db/index.js';
import { ConflictError } from '../../lib/errors.js';
import { addDays, IST_TODAY } from '../../lib/ist.js';

/**
 * Rental capacity, **one definition** (M14 spec §5.7, R5; plan C0-3b). `out(d)` = machines of the listing out on IST
 * day `d`:
 * - bookings `confirmed` / `on_rent`, and `disputed` from `on_rent` (a dispute from `returned` holds nothing: the
 *   machine is back), from their **effective start** `LEAST(start_date, on-site IST date)` (a machine on site a day
 *   early counts from then) to `end_date`; an `on_rent` (or disputed-from-`on_rent`) booking past its end keeps counting
 *   up to today (`GREATEST(end_date, IST_TODAY)`: the machine is still out);
 * - owner blocks, `start_date` … `end_date`.
 * `free(d) = listings.quantity − out(d)`.
 *
 * `out` only rises on a day where an interval starts, so "enough machines on every day of [from, to]" is checked on
 * `from` plus each effective start inside the range (`maxOutInRange`), not on every day; `maxOutInRangeSlow` is the
 * every-day twin the tests prove equal. **A writer that checks capacity holds `lockListingForRental` (`FOR UPDATE`)**
 * first (§6.7), so two writers of one listing run one after the other and the check can't race.
 */

type Conn = Db | Tx;

export interface CapacityOptions {
  /** Leave this booking out (a change or a confirm checks the booking's own new dates against the others). */
  excludeBookingId?: string;
}

const asSql = (v: string | SQL): SQL => (typeof v === 'string' ? sql`${v}::uuid` : v);

/**
 * The listing's capacity intervals as a subquery `(machines, s, e)`: every counted booking and block with its effective
 * start `s` and end `e` (dates). `listingId` is a value or a SQL column (discovery's lateral filter, A2).
 */
export function capacityIntervalsSql(listingId: string | SQL, opts: CapacityOptions = {}): SQL {
  return intervalsSql(listingId, opts, false);
}

/**
 * The intervals; `clash` (the overrun clash check only, never capacity or availability) keeps a booking already past
 * its end out through tomorrow (`GREATEST(end_date, IST_TODAY + 1)`), so it collides with a booking starting tomorrow.
 */
function intervalsSql(listingId: string | SQL, opts: CapacityOptions, clash: boolean): SQL {
  const id = asSql(listingId);
  const exclude = opts.excludeBookingId ? sql`AND b.id <> ${opts.excludeBookingId}::uuid` : sql``;
  const overrunEnd = clash
    ? sql`CASE WHEN b.end_date < ${IST_TODAY} THEN GREATEST(b.end_date, ${IST_TODAY} + 1) ELSE GREATEST(b.end_date, ${IST_TODAY}) END`
    : sql`GREATEST(b.end_date, ${IST_TODAY})`;
  return sql`(
    SELECT b.machines::int AS machines,
      LEAST(b.start_date, COALESCE((b.on_site_at AT TIME ZONE 'Asia/Kolkata')::date, b.start_date)) AS s,
      CASE WHEN b.status IN ('on_rent', 'disputed') THEN ${overrunEnd} ELSE b.end_date END AS e
    FROM rental_bookings b
    WHERE b.listing_id = ${id}
      AND (b.status IN ('confirmed', 'on_rent') OR (b.status = 'disputed' AND b.disputed_from = 'on_rent'))
      ${exclude}
    UNION ALL
    SELECT k.machines::int, k.start_date, k.end_date FROM rental_blocks k WHERE k.listing_id = ${id}
  )`;
}

/** `(d, out)` for every day of `[from, to]` (the spec's §5.7 form; reads and the slow twin). */
export function outByDaySql(listingId: string, from: string, to: string, opts: CapacityOptions = {}): SQL {
  return sql`
    SELECT days.d::date AS d,
      COALESCE((SELECT sum(i.machines) FROM ${capacityIntervalsSql(listingId, opts)} i WHERE days.d::date BETWEEN i.s AND i.e), 0)::int AS out
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS days(d)
  `;
}

/** The most machines out on any day of `[from, to]`: checked on `from` and each effective start inside the range. */
export async function maxOutInRange(conn: Conn, listingId: string, from: string, to: string, opts: CapacityOptions = {}): Promise<number> {
  const { rows } = await conn.execute<{ m: number }>(sql`
    WITH i AS ${capacityIntervalsSql(listingId, opts)},
    days AS (
      SELECT ${from}::date AS d
      UNION
      SELECT i.s FROM i WHERE i.s > ${from}::date AND i.s <= ${to}::date
    )
    SELECT COALESCE(max(o.out), 0)::int AS m
    FROM days CROSS JOIN LATERAL (SELECT COALESCE(sum(i.machines), 0) AS out FROM i WHERE days.d BETWEEN i.s AND i.e) o
  `);
  return Number(rows[0]?.m ?? 0);
}

/** `maxOutInRange` over every day (`generate_series`): only the test uses it, to prove the fast form equal. */
export async function maxOutInRangeSlow(conn: Conn, listingId: string, from: string, to: string, opts: CapacityOptions = {}): Promise<number> {
  const { rows } = await conn.execute<{ m: number }>(sql`SELECT COALESCE(max(x.out), 0)::int AS m FROM (${outByDaySql(listingId, from, to, opts)}) x`);
  return Number(rows[0]?.m ?? 0);
}

/** Machines out today (IST). */
export async function outToday(conn: Conn, listingId: string): Promise<number> {
  const { rows } = await conn.execute<{ m: number }>(sql`
    SELECT COALESCE(sum(i.machines), 0)::int AS m FROM ${capacityIntervalsSql(listingId)} i WHERE ${IST_TODAY} BETWEEN i.s AND i.e
  `);
  return Number(rows[0]?.m ?? 0);
}

/** `quantity − out(today)` (may be negative while an overrun collides); 0 for a listing without a quantity. */
export async function freeToday(conn: Conn, listingId: string): Promise<number> {
  const { rows } = await conn.execute<{ q: string | null }>(sql`SELECT quantity AS q FROM listings WHERE id = ${listingId}::uuid`);
  const quantity = Math.floor(Number(rows[0]?.q ?? 0));
  return quantity - (await outToday(conn, listingId));
}

export function datesTaken(free: number): ConflictError {
  return new ConflictError('Those dates are already booked', 'RENTAL_DATES_TAKEN', { free: Math.max(0, free) });
}

/**
 * `409 RENTAL_DATES_TAKEN` (`details.free`: the fewest machines free on a day of the range) unless `machines` more fit
 * on every day of `[from, to]`. **The caller must hold `lockListingForRental(listing.id)`** (§6.7): two transactions
 * each checking and then inserting for the last machine run one after the other (pinned by `m14-capacity.test.ts`).
 */
export async function assertCapacity(
  tx: Tx,
  listing: { id: string; quantity: number },
  range: { from: string; to: string },
  machines: number,
  opts: CapacityOptions = {},
): Promise<void> {
  const out = await maxOutInRange(tx, listing.id, range.from, range.to, opts);
  if (out + machines > listing.quantity) throw datesTaken(listing.quantity - out);
}

/** A listing row's `quantity` (numeric string) as whole machines. */
export function machinesOf(listing: { quantity: string | null }): number {
  return Math.floor(Number(listing.quantity ?? 0));
}

/** Machines out on `day` for the clash check (`intervalsSql` with `clash`: an overrun counts through tomorrow). */
async function clashOutOn(conn: Conn, listingId: string, day: string): Promise<number> {
  const { rows } = await conn.execute<{ m: number }>(sql`
    SELECT COALESCE(sum(i.machines), 0)::int AS m FROM ${intervalsSql(listingId, {}, true)} i WHERE ${day}::date BETWEEN i.s AND i.e
  `);
  return Number(rows[0]?.m ?? 0);
}

/**
 * The overrun clash of §6.4 for one booking, or null. For an `on_rent` (or disputed-from-`on_rent`) booking past its
 * end date: the earliest `confirmed` booking of the listing starting today or tomorrow (IST) on whose start day `out`
 * exceeds the quantity, the overrun counted out through tomorrow (`clashOutOn`). For such a `confirmed` booking: the earliest overrunning booking of the listing. Read by A1-4's
 * view ("Machine still out from #700012") and A2-3's job (the owner's `rental_booking_clash`, once per pair).
 */
export async function clashWithFor(conn: Conn, bookingId: string): Promise<{ id: string; ref: number } | null> {
  const { rows } = await conn.execute<{
    id: string;
    listing_id: string;
    status: string;
    disputed_from: string | null;
    start_date: string;
    end_date: string;
    today: string;
    quantity: string | null;
  }>(sql`
    SELECT b.id, b.listing_id, b.status, b.disputed_from, b.start_date::text, b.end_date::text, ${IST_TODAY}::text AS today,
      l.quantity
    FROM rental_bookings b JOIN listings l ON l.id = b.listing_id
    WHERE b.id = ${bookingId}::uuid
  `);
  const b = rows[0];
  if (!b) return null;
  const quantity = Math.floor(Number(b.quantity ?? 0));
  const overrunning = (b.status === 'on_rent' || (b.status === 'disputed' && b.disputed_from === 'on_rent')) && b.end_date < b.today;
  const overrunSql = sql`(o.status = 'on_rent' OR (o.status = 'disputed' AND o.disputed_from = 'on_rent')) AND o.end_date < ${IST_TODAY}`;
  const nextSql = sql`o.status = 'confirmed' AND o.start_date BETWEEN ${IST_TODAY} AND ${IST_TODAY} + 1`;

  if (overrunning) {
    const { rows: next } = await conn.execute<{ id: string; ref: string | number; start_date: string }>(sql`
      SELECT o.id, o.ref, o.start_date::text FROM rental_bookings o
      WHERE o.listing_id = ${b.listing_id}::uuid AND o.id <> ${b.id}::uuid AND ${nextSql}
      ORDER BY o.start_date, o.ref
    `);
    for (const n of next) {
      if ((await clashOutOn(conn, b.listing_id, n.start_date)) > quantity) return { id: n.id, ref: Number(n.ref) };
    }
    return null;
  }
  const startsSoon = b.status === 'confirmed' && b.start_date >= b.today && b.start_date <= addDays(b.today, 1);
  if (!startsSoon || (await clashOutOn(conn, b.listing_id, b.start_date)) <= quantity) return null;
  const { rows: over } = await conn.execute<{ id: string; ref: string | number }>(sql`
    SELECT o.id, o.ref FROM rental_bookings o
    WHERE o.listing_id = ${b.listing_id}::uuid AND o.id <> ${b.id}::uuid AND ${overrunSql}
    ORDER BY o.ref LIMIT 1
  `);
  return over[0] ? { id: over[0].id, ref: Number(over[0].ref) } : null;
}
