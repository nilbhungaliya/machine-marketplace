import {
  RENTAL_LIMITS, type RentalBlockView, type RentalCalendar, type RentalCalendarDay,
} from '@mpm/shared-types';
import { toAsciiDigits } from './digits';

// The owner's calendar (M14 spec §7.3; plan B3-2): a month grid with machines out / free per day, what covers a day,
// and the block form. Pure; calendar dates are `YYYY-MM-DD` read as UTC midnight (no time zone involved).

/** `free`: nothing out · `partial`: some out · `full`: none free · `none`: outside the fetched window. */
export type CalendarDayState = 'free' | 'partial' | 'full' | 'none';

export interface CalendarCell {
  date: string;
  /** In the month shown (the grid pads with the neighbouring months' days). */
  inMonth: boolean;
  out: number;
  free: number;
  state: CalendarDayState;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const utc = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};

export function addDays(date: string, n: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** The state of a day from its numbers (a day with nothing free is `full`, even when the quantity is 0). */
export function dayState(day: Pick<RentalCalendarDay, 'out' | 'free'> | undefined): CalendarDayState {
  if (!day) return 'none';
  if (day.free <= 0) return 'full';
  return day.out > 0 ? 'partial' : 'free';
}

/** The first and last day the grid of `month` (1–12) shows: Monday on or before the 1st → Sunday on or after the last. */
export function gridRange(year: number, month: number): { from: string; to: string } {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const back = (first.getUTCDay() + 6) % 7; // Monday = 0
  const ahead = (7 - last.getUTCDay()) % 7; // to Sunday
  return { from: addDays(iso(first), -back), to: addDays(iso(last), ahead) };
}

/**
 * The month view (§7.3): weeks starting Monday, 5 or 6 rows, each cell with the day's out / free and state from
 * `days` (`GET /listings/:id/calendar`); a day outside them is `none` (0 / 0).
 */
export function monthGrid(year: number, month: number, days: readonly RentalCalendarDay[]): CalendarCell[][] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const { from, to } = gridRange(year, month);
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const rows: CalendarCell[][] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (rows.length === 0 || rows[rows.length - 1]!.length === 7) rows.push([]);
    const day = byDate.get(date);
    rows[rows.length - 1]!.push({
      date,
      inMonth: date.startsWith(prefix),
      out: day?.out ?? 0,
      free: day?.free ?? 0,
      state: dayState(day),
    });
  }
  return rows;
}

/** The month `delta` months from `year` / `month` (1–12). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const i = year * 12 + (month - 1) + delta;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

/** `YYYY-MM-DD` → its year and month (1–12). */
export function monthOf(date: string): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

const covers = (x: { startDate: string; endDate: string }, date: string) => x.startDate <= date && date <= x.endDate;

/**
 * What the owner sees under the grid for one day: the bookings counted on it (their capacity span, so a machine still
 * out past its end date or put on site the day before shows on those days too) and the blocks covering it.
 */
export function dayItems(cal: Pick<RentalCalendar, 'bookings' | 'blocks'>, date: string): {
  bookings: RentalCalendar['bookings'];
  blocks: RentalBlockView[];
} {
  return {
    bookings: cal.bookings.filter((b) => b.spanStart <= date && date <= b.spanEnd),
    blocks: cal.blocks.filter((b) => covers(b, date)),
  };
}

// ─── The block form ───

export interface BlockFormErrors {
  dates?: 'required' | 'past' | 'tooLong';
  machines?: 'invalid';
  note?: 'tooLong';
}

/**
 * Add / edit a block (§7.3, server checks in `blocks.service.ts`): a start and an end, the end not before today, at
 * most 366 days; machines 1 … the listing's quantity; note ≤ 200. Capacity is the server's (`409 RENTAL_DATES_TAKEN`).
 */
export function blockFormErrors(
  v: { startDate: string | null; endDate: string | null; machines: string; note: string },
  quantity: number,
  today: string,
  /**
   * The block being edited: its dates and machines are checked only when they change (a note-only edit of a past
   * block, or of one over a since-lowered quantity, saves as the server allows).
   */
  original?: Pick<RentalBlockView, 'startDate' | 'endDate' | 'machines'> | null,
): BlockFormErrors {
  const e: BlockFormErrors = {};
  const m = blockMachines(v.machines);
  const sameDates = !!original && v.startDate === original.startDate && v.endDate === original.endDate;
  const sameMachines = !!original && m === original.machines;
  if (!v.startDate || !v.endDate || v.endDate < v.startDate) e.dates = 'required';
  else if (sameDates) {
    // Unchanged dates: nothing more to check.
  } else if (v.endDate < today) e.dates = 'past';
  else {
    const span = Math.round((utc(v.endDate).getTime() - utc(v.startDate).getTime()) / 86_400_000) + 1;
    if (span > RENTAL_LIMITS.blockRangeMaxDays) e.dates = 'tooLong';
  }
  if (m == null || m < 1) e.machines = 'invalid';
  else if (!sameMachines && m > Math.max(1, quantity)) e.machines = 'invalid';
  if ([...v.note.trim()].length > RENTAL_LIMITS.blockNoteMax) e.note = 'tooLong';
  return e;
}

/** Typed machines (any script's digits) → a whole number, or null. */
export function blockMachines(text: string): number | null {
  const clean = toAsciiDigits(text).trim();
  return /^\d{1,4}$/.test(clean) ? Number(clean) : null;
}
