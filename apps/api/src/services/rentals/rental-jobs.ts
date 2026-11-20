import { and, asc, eq, gt, sql, type SQL } from 'drizzle-orm';
import type { NotificationType } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { listings, rentalBookings } from '../../db/schema.js';
import { IST_TODAY } from '../../lib/ist.js';
import { Sentry } from '../../lib/sentry.js';
import { runJobTx, type TxApp } from '../../lib/tx-effects.js';
import { notifyBooking, writeBookingStatus, type BookingNotify } from './booking-write.js';
import { capacityIntervalsSql } from './capacity.js';
import { detectClashes, overrunListingIdsSql } from './clash.js';
import { lockRentalBooking, type RentalBookingRow } from './locks.js';
import { syncRentalStatus } from './status-sync.js';

/**
 * The four rental jobs (M14 spec §9, plan A2-3; the F6 `deal-jobs.ts` / F8 `request-jobs.ts` shape), registered in
 * `jobs/index.ts`. Every rule reads the database clock (`now()`, `IST_TODAY`).
 *
 * Booking jobs read candidate ids **unlocked**, then per booking in a transaction of its own (`runJobTx`, so emits and
 * notifications behave as a route's): the listing `FOR UPDATE SKIP LOCKED` first (§6.7), then the booking `FOR NO KEY
 * UPDATE SKIP LOCKED` (`lockRentalBooking`), re-check the due rule under the locks, act. A row whose listing or booking
 * another write (or a second run) holds is skipped; the next tick looks again, and a run that gets it after the other
 * committed fails the re-check, so each booking changes once. Candidates are paged by id. The status-sync job locks each candidate listing `FOR UPDATE SKIP LOCKED`. A failing row is logged and
 * skipped; the rest go on.
 */

const BATCH = 100;

async function sweepBookings(
  app: TxApp,
  job: string,
  due: () => SQL,
  work: (tx: Tx, b: RentalBookingRow) => Promise<boolean>,
): Promise<number> {
  let done = 0;
  let after = '00000000-0000-0000-0000-000000000000';
  // Keyset over booking ids: a row that stays due (locked, failing) is visited once per run.
  for (;;) {
    const candidates = await app.db
      .select({ id: rentalBookings.id, listingId: rentalBookings.listingId })
      .from(rentalBookings)
      .where(and(gt(rentalBookings.id, after), due()))
      .orderBy(asc(rentalBookings.id))
      .limit(BATCH);
    for (const c of candidates) {
      try {
        const ok = await runJobTx(app, async (tx) => {
          // The listing first (§6.7); one another write holds is skipped, not waited on (the next tick looks again).
          const [listing] = await tx
            .select({ id: listings.id })
            .from(listings)
            .where(eq(listings.id, c.listingId))
            .for('update', { skipLocked: true });
          if (!listing) return false;
          const b = await lockRentalBooking(tx, c.id, { skipLocked: true });
          if (!b) return false;
          const [still] = await tx
            .select({ id: rentalBookings.id })
            .from(rentalBookings)
            .where(and(eq(rentalBookings.id, b.id), due()));
          return still ? work(tx, b) : false;
        });
        if (ok) done++;
      } catch (err) {
        app.log.error({ err, job, bookingId: c.id }, 'rental job failed on a booking');
        Sentry.captureException(err, { tags: { job }, extra: { bookingId: c.id } });
      }
    }
    if (candidates.length < BATCH) break;
    after = candidates[candidates.length - 1]!.id;
  }
  return done;
}

const SYSTEM = { side: 'system' } as const;

/**
 * `rental-booking-expiry` (5 min, R4): `requested` / `countered` bookings past `reply_due_at`, or whose start date is
 * before today (IST), → `expired`; both sides told (`rental_booking_expired`).
 */
export async function runRentalBookingExpiry(app: TxApp): Promise<number> {
  const due = () =>
    sql`${rentalBookings.status} IN ('requested', 'countered')
      AND (${rentalBookings.replyDueAt} <= now() OR ${rentalBookings.startDate} < ${IST_TODAY})`;
  return sweepBookings(app, 'rental-booking-expiry', due, async (tx, b) => {
    await writeBookingStatus(tx, b, 'expire', SYSTEM, {}, { notify: [{ to: 'both', type: 'rental_booking_expired' }] });
    return true;
  });
}

/**
 * `rental-booking-auto-complete` (5 min, R6): `returned` bookings past `auto_complete_at` → `completed` (`auto`); both
 * told with the review prompt (`rental_booking_completed`). A disputed booking fails the re-check.
 */
export async function runRentalAutoComplete(app: TxApp): Promise<number> {
  const due = () => sql`${rentalBookings.status} = 'returned' AND ${rentalBookings.autoCompleteAt} <= now()`;
  return sweepBookings(app, 'rental-booking-auto-complete', due, async (tx, b) => {
    await writeBookingStatus(tx, b, 'auto_complete', SYSTEM, { completedHow: 'auto' }, {
      notify: [{ to: 'both', type: 'rental_booking_completed' }],
    });
    return true;
  });
}

interface Reminder {
  job: string;
  type: NotificationType;
  to: BookingNotify['to'];
  due: () => SQL;
  stamp: 'startRemindedAt' | 'dueRemindedAt' | 'overdueRemindedAt' | 'notStartedRemindedAt';
}

/** §9's reminders: each stamps its own column, so no booking hears one twice (across runs and across midnight). */
const REMINDERS: Reminder[] = [
  {
    job: 'starts-tomorrow',
    type: 'rental_booking_starts_tomorrow',
    to: 'both',
    stamp: 'startRemindedAt',
    due: () =>
      sql`${rentalBookings.status} = 'confirmed' AND ${rentalBookings.startDate} = ${IST_TODAY} + 1
        AND ${rentalBookings.startRemindedAt} IS NULL`,
  },
  {
    job: 'due-back',
    type: 'rental_booking_due_back',
    to: 'both',
    stamp: 'dueRemindedAt',
    due: () =>
      sql`${rentalBookings.status} = 'on_rent' AND ${rentalBookings.endDate} = ${IST_TODAY} AND ${rentalBookings.dueRemindedAt} IS NULL`,
  },
  {
    job: 'overdue',
    type: 'rental_booking_overdue',
    to: 'owner',
    stamp: 'overdueRemindedAt',
    due: () =>
      sql`${rentalBookings.status} = 'on_rent' AND ${rentalBookings.endDate} < ${IST_TODAY} AND ${rentalBookings.overdueRemindedAt} IS NULL`,
  },
  {
    // Confirmed, past the start and never marked on site: "Mark on site or cancel" (no auto-cancel, §6.4).
    job: 'not-started',
    type: 'rental_booking_not_started',
    to: 'both',
    stamp: 'notStartedRemindedAt',
    due: () =>
      sql`${rentalBookings.status} = 'confirmed' AND ${rentalBookings.startDate} < ${IST_TODAY}
        AND ${rentalBookings.notStartedRemindedAt} IS NULL`,
  },
];

/** Reminders go out in the IST daytime only (08:00–20:59), never just after midnight. */
export const REMINDER_HOURS = { from: 8, to: 20 } as const;

/** The IST hour now: from `now` when given (tests), else the database clock. */
async function istHour(app: TxApp, now?: Date): Promise<number> {
  if (now) return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const { rows } = await app.db.execute<{ h: number }>(sql`SELECT extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::int AS h`);
  return Number(rows[0]?.h ?? 0);
}

/**
 * `rental-booking-reminders` (hourly): starts tomorrow, due back today, overdue (owner), not started; each once, and
 * only while the IST hour is within `REMINDER_HOURS` (outside it the run sends nothing; the next daytime run does).
 * `opts.now` overrides the clock the gate reads (tests); the due rules always read the database's IST date.
 */
export async function runRentalReminders(app: TxApp, opts: { now?: Date } = {}): Promise<number> {
  const hour = await istHour(app, opts.now);
  if (hour < REMINDER_HOURS.from || hour > REMINDER_HOURS.to) return 0;
  let sent = 0;
  for (const r of REMINDERS) {
    sent += await sweepBookings(app, `rental-booking-reminders:${r.job}`, r.due, async (tx, b) => {
      await tx.update(rentalBookings).set({ [r.stamp]: sql`now()` }).where(eq(rentalBookings.id, b.id));
      await notifyBooking(tx, b, { to: r.to, type: r.type, dedupeKey: `${r.type}:${b.id}` });
      return true;
    });
  }
  return sent;
}

/**
 * `rental-status-sync` (15 min, R7, §6.4): rental listings in `live` / `rented` whose status disagrees with today's
 * capacity (`rented` ≠ nothing free today; this also brings back listings left `rented` by the retired manual "Mark
 * rented"), plus listings with a booking still out past its end. Each listing in its own transaction, locked `FOR
 * UPDATE SKIP LOCKED` (a listing a write holds is synced by that write), then `syncRentalStatus` and `detectClashes`.
 * Keyset over listing ids, so a listing that stays a candidate (an unresolved overrun) is visited once per run.
 */
export async function runRentalStatusSync(app: TxApp): Promise<number> {
  let after = '00000000-0000-0000-0000-000000000000';
  let done = 0;
  for (;;) {
    const outToday = sql`(SELECT COALESCE(sum(i.machines), 0) FROM ${capacityIntervalsSql(sql`l.id`)} i WHERE ${IST_TODAY} BETWEEN i.s AND i.e)`;
    const { rows } = await app.db.execute<{ id: string }>(sql`
      SELECT c.id FROM (
        SELECT l.id FROM listings l
        WHERE l.kind = 'machine_rental' AND l.status IN ('live', 'rented') AND l.quantity IS NOT NULL
          AND (l.status = 'rented') <> (${outToday} >= floor(l.quantity))
        UNION
        ${overrunListingIdsSql}
      ) c
      WHERE c.id > ${after}::uuid
      ORDER BY c.id
      LIMIT ${BATCH}
    `);
    for (const { id } of rows) {
      try {
        const ok = await runJobTx(app, async (tx) => {
          const [listing] = await tx
            .select()
            .from(listings)
            .where(and(eq(listings.id, id), eq(listings.kind, 'machine_rental')))
            .for('update', { skipLocked: true });
          if (!listing) return false;
          const moved = await syncRentalStatus(tx, listing);
          const clashes = await detectClashes(tx, listing.id);
          return moved !== null || clashes > 0;
        });
        if (ok) done++;
      } catch (err) {
        app.log.error({ err, job: 'rental-status-sync', listingId: id }, 'rental status sync failed on a listing');
        Sentry.captureException(err, { tags: { job: 'rental-status-sync' }, extra: { listingId: id } });
      }
    }
    if (rows.length < BATCH) break;
    after = rows[rows.length - 1]!.id;
  }
  return done;
}
