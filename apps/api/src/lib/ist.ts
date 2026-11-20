import { sql } from 'drizzle-orm';

// India Standard Time, one definition (M14 plan D11, spec §5.7). Business days (booking dates, daily limits, push
// caps, the search log) are IST calendar dates `YYYY-MM-DD`. Every rule the database checks uses `IST_TODAY` /
// `IST_MIDNIGHT` (the DB clock); pure functions take `today` as a parameter, computed with `istToday()`.

const IST = 'Asia/Kolkata';

/** Today in India (IST), as a SQL `date`. */
export const IST_TODAY = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;

/** IST midnight today, as a SQL `timestamptz` (the start of today's daily limits). */
export const IST_MIDNIGHT = sql`(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;

const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The IST calendar date of an instant, `YYYY-MM-DD`. */
export function istDateOf(d: Date): string {
  return DATE_FORMAT.format(d);
}

/** Today in India, `YYYY-MM-DD` (the app clock; `IST_TODAY` for rules the database checks). */
export function istToday(now: Date = new Date()): string {
  return istDateOf(now);
}

/** `date` plus `n` calendar days (negative goes back), `YYYY-MM-DD`; no time zone involved. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
