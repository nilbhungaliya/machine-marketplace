import { sql, type SQL } from 'drizzle-orm';
import { DASHBOARD_CUSTOM_MAX_DAYS, type AdminDashboardQuery } from '@mpm/shared-types';
import { ValidationError } from '../../lib/errors.js';
import { addDays } from '../../lib/ist.js';

// AD1 dashboard periods (admin close-out R3, plan A1-1; textile `admin-insights/dashboard.ts` `periods`). Every period
// is a run of IST calendar days `[from, to]`, compared with the same number of days just before it (`[prevFrom,
// prevTo]`). The trend is daily up to 31 days, weekly (Monday weeks) beyond.

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
/** Daily trend buckets up to this many days, weekly beyond (R3, my call). */
export const DASHBOARD_DAILY_MAX_DAYS = 31;

export interface DashboardPeriod {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  days: number;
  granularity: 'day' | 'week';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** A real calendar date `YYYY-MM-DD` (not 2026-02-30). */
function isDate(s: string | undefined): s is string {
  return !!s && DATE_RE.test(s) && addDays(s, 0) === s;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

function rangeInvalid(message: string): ValidationError {
  return new ValidationError(message, undefined, 'DASHBOARD_RANGE_INVALID');
}

/**
 * The period asked for and the one before it. `7d` / `30d` / `90d` end today (7d = today − 6 … today); `custom` needs
 * `from` and `to` with `from ≤ to ≤ today` and at most 366 days, else `400 DASHBOARD_RANGE_INVALID`. `today` is the IST
 * date (`istToday()`), a parameter so the rule stays pure.
 */
export function resolveDashboardPeriod(q: Pick<AdminDashboardQuery, 'range' | 'from' | 'to'>, today: string): DashboardPeriod {
  let from: string;
  let to: string;
  if (q.range === 'custom') {
    if (!isDate(q.from) || !isDate(q.to)) throw rangeInvalid('A custom range needs a from and a to date');
    from = q.from;
    to = q.to;
    if (from > to) throw rangeInvalid('The start date must not be after the end date');
    if (to > today) throw rangeInvalid('The range must not end after today');
    if (daysBetween(from, to) > DASHBOARD_CUSTOM_MAX_DAYS) {
      throw rangeInvalid(`A custom range spans at most ${DASHBOARD_CUSTOM_MAX_DAYS} days`);
    }
  } else {
    to = today;
    from = addDays(today, -(RANGE_DAYS[q.range] - 1));
  }
  const days = daysBetween(from, to);
  return {
    from,
    to,
    prevFrom: addDays(from, -days),
    prevTo: addDays(from, -1),
    days,
    granularity: days <= DASHBOARD_DAILY_MAX_DAYS ? 'day' : 'week',
  };
}

/** The start of an IST day as a `timestamptz`. */
export function istDayStart(day: string): SQL {
  return sql`((${day}::date)::timestamp AT TIME ZONE 'Asia/Kolkata')`;
}

/** A half-open instant window `[start, end)`. */
export interface Window {
  start: SQL;
  end: SQL;
}

/** The period's window and the previous period's, as instants (IST day starts). */
export function periodWindows(p: DashboardPeriod): { current: Window; previous: Window } {
  return {
    current: { start: istDayStart(p.from), end: istDayStart(addDays(p.to, 1)) },
    previous: { start: istDayStart(p.prevFrom), end: istDayStart(p.from) },
  };
}
