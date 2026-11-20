import { rentalEndDate, type RentalAvailabilityDay, type RentalPeriod } from '@mpm/shared-types';

// Rental calendar dates on the phone (M14 spec §6.2, R1, R13): IST calendar dates `YYYY-MM-DD`, compared as strings and
// moved as UTC midnights (no device time zone). Pure: the date sheet, the Request booking form and search's "Free on"
// read them. Today is always a parameter (`istDateKey()` from `lib/ist-date.ts` at the call site).

/** `date` moved by `n` calendar days. */
export function addIsoDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Days from `a` to `b` (`b − a`), whole calendar days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Calendar days a range covers, both ends included ("21–23 Nov" → 3). */
export function rangeLength(start: string, end: string): number {
  return daysBetween(start, end) + 1;
}

/** A real `YYYY-MM-DD` date (not 2026-02-30). */
export function isIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}

/** A request's dates (R1): the start and its end by the period's calendar days (a month is 30 days). */
export function rangeFromStart(start: string, period: RentalPeriod, count: number): { start: string; end: string } {
  return { start, end: rentalEndDate(start, period, count) };
}

/** The full days of an availability window (`state: 'full'`): greyed and not pickable in the date sheet. */
export function busyDates(days: readonly RentalAvailabilityDay[] | null | undefined): Set<string> {
  return new Set((days ?? []).filter((d) => d.state === 'full').map((d) => d.date));
}

/** Whether any day of `[start, end]` (both included) is full: the request would be refused (`RENTAL_DATES_TAKEN`). */
export function rangeHasFullDay(start: string, end: string, busy: ReadonlySet<string>): boolean {
  if (busy.size === 0 || end < start) return false;
  for (let d = start; d <= end; d = addIsoDays(d, 1)) if (busy.has(d)) return true;
  return false;
}

/** One cell of a month grid: a date of that month, or null (padding before the 1st / after the last day). */
export type MonthCell = string | null;

/**
 * A month as weeks of 7 cells, Sunday first (the app's `weekdayShortNames()` order): padding cells are null.
 * `month` is 0–11.
 */
export function monthGrid(year: number, month: number): MonthCell[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: MonthCell[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** `{ year, month }` (0–11) of a date, and the month `n` months later. */
export function monthOf(date: string): { year: number; month: number } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return { year: y, month: m - 1 };
}

export function addMonths(ym: { year: number; month: number }, n: number): { year: number; month: number } {
  const total = ym.year * 12 + ym.month + n;
  return { year: Math.floor(total / 12), month: total % 12 };
}

/**
 * The date sheet's range picking: the first tap sets the start; the next tap on or after it sets the end (capped at
 * `maxDays`, both ends included); a tap before the start, or after a full range, starts again.
 */
export function nextRangePick(
  current: { start: string; end?: string } | null,
  tapped: string,
  maxDays: number,
): { start: string; end?: string } {
  if (!current || current.end !== undefined || tapped < current.start) return { start: tapped };
  const last = addIsoDays(current.start, maxDays - 1);
  return { start: current.start, end: tapped > last ? last : tapped };
}
