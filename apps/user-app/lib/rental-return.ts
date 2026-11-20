import {
  meetsRentalMinimum, RENTAL_LIMITS, RENTAL_PERIODS, rentalCountLimits, rentalEndDate, rentalEstimate,
  resolveRentalChoices, type RentalFinalReason, type RentalPeriod, type RentalTermsSnapshot, type RentalVersionView,
} from '@mpm/shared-types';
import { toAsciiDigits } from './digits';
import { parseRupees } from './money';

// The owner's step forms (M14 spec §6.3, §6.4; plan B3-1): the change sheet's terms, total and "% vs estimate", and the
// On site / Returned sheets' hour meters, final amount and reason. Pure; money is integer paise, never floats.

/** Highest total an owner may type (§6.3: 0 … 10¹⁰ paise). */
export const OWNER_TOTAL_MAX_PAISE = 10_000_000_000;

/**
 * The owner's total against the server's estimate for the same terms, as a whole signed percent (§6.3): 9 000 against
 * 10 000 → −10, 11 000 → +10. 0 when there is no estimate to compare with (a zero estimate).
 */
export function percentVsEstimate(totalPaise: number, estimatePaise: number): number {
  if (!Number.isFinite(totalPaise) || !Number.isFinite(estimatePaise) || estimatePaise <= 0) return 0;
  const pct = Math.round(((totalPaise - estimatePaise) / estimatePaise) * 100);
  return pct === 0 ? 0 : pct; // never −0
}

/** A typed hour meter: empty → null (it is optional), digits in any script → a whole number, else `invalid`. */
export function parseHourMeter(text: string): { value: number | null; invalid: boolean } {
  const clean = toAsciiDigits(text).replace(/[,\s]/g, '');
  if (clean === '') return { value: null, invalid: false };
  if (!/^\d{1,7}$/.test(clean)) return { value: null, invalid: true };
  const value = Number(clean);
  return value > RENTAL_LIMITS.hourMeterMax ? { value: null, invalid: true } : { value, invalid: false };
}

const tooLong = (text: string | null | undefined, max: number): boolean => [...(text ?? '').trim()].length > max;

export interface ReturnFormValues {
  /** The final amount typed, in paise; null when empty or unreadable. */
  finalPaise: number | null;
  agreedPaise: number;
  reason: RentalFinalReason | null;
  /** The opening hour meter (from On site), when one was recorded. */
  hourStart: number | null;
  /** The closing hour meter; null when left empty. */
  hourEnd: number | null;
  /** The closing meter's text could not be read. */
  hourEndInvalid?: boolean;
  finalNote?: string;
  damageNote?: string;
}

export interface ReturnFormErrors {
  final?: 'required' | 'tooHigh';
  reason?: 'required';
  hourEnd?: 'invalid' | 'belowStart';
  finalNote?: 'tooLong';
  damageNote?: 'tooLong';
}

/**
 * Mark returned (§6.4): the final amount is required (prefilled with the agreed total); a different amount needs a
 * reason (`FINAL_REASON_REQUIRED`); the closing hour meter can't be lower than the opening one (`HOUR_METER_INVALID`);
 * final note ≤ 300, damage note ≤ 500.
 */
export function returnFormErrors(v: ReturnFormValues): ReturnFormErrors {
  const e: ReturnFormErrors = {};
  if (v.finalPaise == null) e.final = 'required';
  else if (v.finalPaise > OWNER_TOTAL_MAX_PAISE) e.final = 'tooHigh';
  if (v.finalPaise != null && v.finalPaise !== v.agreedPaise && !v.reason) e.reason = 'required';
  if (v.hourEndInvalid) e.hourEnd = 'invalid';
  else if (v.hourEnd != null && v.hourStart != null && v.hourEnd < v.hourStart) e.hourEnd = 'belowStart';
  if (tooLong(v.finalNote, RENTAL_LIMITS.shortNoteMax)) e.finalNote = 'tooLong';
  if (tooLong(v.damageNote, RENTAL_LIMITS.damageNoteMax)) e.damageNote = 'tooLong';
  return e;
}

export const hasFormErrors = (e: object): boolean => Object.keys(e).length > 0;

// ─── Propose a change (owner, §6.3) ───

/** The periods the booking's terms price, in order (Charged by). */
export function offeredPeriods(terms: RentalTermsSnapshot): RentalPeriod[] {
  const rate: Record<RentalPeriod, number | null> = {
    hour: terms.rateHourPaise, day: terms.rateDayPaise, week: terms.rateWeekPaise, month: terms.rateMonthPaise,
  };
  return RENTAL_PERIODS.filter((p) => rate[p] != null);
}

export interface ChangeFormValues {
  startDate: string;
  period: RentalPeriod;
  /** Typed text (any script's digits). */
  count: string;
  machines: string;
  withOperator: boolean;
  ownerDelivers: boolean;
  /** Typed rupees; empty → the estimate. */
  total: string;
  message: string;
}

export interface ChangeFormErrors {
  count?: 'invalid' | 'belowMinimum';
  machines?: 'invalid';
  total?: 'invalid';
  message?: 'tooLong';
}

const wholeNumber = (text: string): number | null => {
  const clean = toAsciiDigits(text).trim();
  return /^\d{1,4}$/.test(clean) ? Number(clean) : null;
};

/** The change sheet's form from the open version. */
export function changeFormFrom(v: RentalVersionView): ChangeFormValues {
  return {
    startDate: v.startDate,
    period: v.period,
    count: String(v.count),
    machines: String(v.machines),
    withOperator: v.withOperator,
    ownerDelivers: v.ownerDelivers,
    total: '',
    message: '',
  };
}

/**
 * The terms the form describes, checked as the server does (§6.2): count within the period's limits and the listing's
 * minimum, machines 1 … 1000 (the server checks the listing's quantity), the owner's total 0 … 10¹⁰ paise (empty →
 * the estimate), message ≤ 300. `estimate` is `rentalEstimate` on the booking's own terms snapshot (rates never move
 * under a booking), so the owner sees the number the server stores.
 */
export function readChangeForm(values: ChangeFormValues, terms: RentalTermsSnapshot): {
  errors: ChangeFormErrors;
  count: number | null;
  machines: number | null;
  endDate: string | null;
  estimatePaise: number | null;
  totalPaise: number | null;
  choices: { withOperator: boolean; ownerDelivers: boolean };
} {
  const errors: ChangeFormErrors = {};
  const limits = rentalCountLimits[values.period];
  const count = wholeNumber(values.count);
  if (count == null || count < limits.min || count > limits.max) errors.count = 'invalid';
  else if (!meetsRentalMinimum(terms, values.period, count)) errors.count = 'belowMinimum';
  const machines = wholeNumber(values.machines);
  if (machines == null || machines < 1 || machines > RENTAL_LIMITS.machinesMax) errors.machines = 'invalid';
  const choices = resolveRentalChoices(terms, values);
  const okCount = errors.count === 'invalid' ? null : count;
  const okMachines = errors.machines ? null : machines;
  const est = okCount != null && okMachines != null
    ? rentalEstimate(terms, { period: values.period, count: okCount, machines: okMachines, ...choices })
    : null;
  const estimatePaise = est?.totalPaise ?? null;
  let totalPaise: number | null = estimatePaise;
  if (values.total.trim() !== '') {
    const typed = parseRupees(values.total);
    if (typed == null || typed > OWNER_TOTAL_MAX_PAISE) {
      errors.total = 'invalid';
      totalPaise = null;
    } else totalPaise = typed;
  }
  if (tooLong(values.message, RENTAL_LIMITS.messageMax)) errors.message = 'tooLong';
  return {
    errors,
    count: okCount,
    machines: okMachines,
    endDate: okCount != null ? rentalEndDate(values.startDate, values.period, okCount) : null,
    estimatePaise,
    totalPaise,
    choices,
  };
}
