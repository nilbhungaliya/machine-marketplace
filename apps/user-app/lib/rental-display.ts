import {
  rentalBookingActions, rentalEstimate,
  type RentalBookingActionKey, type RentalBookingStatus, type RentalBookingView, type RentalEstimateResult,
  type RentalPeriod, type RentalTermsSnapshot, type RentalVersionView,
} from '@mpm/shared-types';
import type { StatusTone } from '@/components/StatusChip';
import type { Language } from '@/lib/i18n';
import { monthShortNamesFor } from './format-date';

// How a rental booking shows (M14 spec §14.2; mockup flow `rental`). Pure; copy keys under `rentals.*`. Money stays
// integer paise; buttons come from the shared `rentalBookingActions` (the server checks every action again).

export type BookingSide = 'renter' | 'owner';

/**
 * The status chip (spec §6.6): an open booking reads by whose answer it waits for — "Your answer" (`new`) for the side
 * whose turn it is, "Waiting for the owner / renter" (`warn`) for the other; agreed and running bookings are `info`,
 * returned `warn`, completed `ok`, disputed `danger`, the closed ones `neutral`.
 */
export function bookingStatusChip(status: RentalBookingStatus, side: BookingSide): { tone: StatusTone; key: string } {
  switch (status) {
    case 'requested':
      return side === 'owner'
        ? { tone: 'new', key: 'rentals.status.yourAnswer' }
        : { tone: 'warn', key: 'rentals.status.waitingOwner' };
    case 'countered':
      return side === 'renter'
        ? { tone: 'new', key: 'rentals.status.yourAnswer' }
        : { tone: 'warn', key: 'rentals.status.waitingRenter' };
    case 'confirmed':
    case 'on_rent':
      return { tone: 'info', key: `rentals.status.${status}` };
    case 'returned':
      return { tone: 'warn', key: 'rentals.status.returned' };
    case 'completed':
      return { tone: 'ok', key: 'rentals.status.completed' };
    case 'disputed':
      return { tone: 'danger', key: 'rentals.status.disputed' };
    case 'declined':
    case 'withdrawn':
    case 'expired':
    case 'cancelled':
    default:
      return { tone: 'neutral', key: `rentals.status.${status}` };
  }
}

/** "Hour" / "Day" / "Week" / "Month" (the Charged by segments). */
export function periodLabelKey(period: RentalPeriod): string {
  return `rentals.period.${period}`;
}

export interface MoneyLine {
  key: string;
  paise: number;
}

/**
 * The estimate card's lines: rent, operator and transport (zero parts left out), then the total. A version carries only
 * its estimate and total: with the booking's `terms` its parts are recomputed (`rentalEstimate`, the server's rule);
 * without them, or when the owner's total differs from the estimate (§6.3), the estimate shows as its own line.
 */
export function estimateLines(e: RentalEstimateResult | RentalVersionView, terms?: RentalTermsSnapshot): MoneyLine[] {
  const lines: MoneyLine[] = [];
  const isResult = 'rentPaise' in e;
  const parts = isResult ? e : terms ? rentalEstimate(terms, e) : null;
  if (parts) {
    if (parts.rentPaise > 0) lines.push({ key: 'rentals.money.rent', paise: parts.rentPaise });
    if (parts.operatorPaise > 0) lines.push({ key: 'rentals.money.operator', paise: parts.operatorPaise });
    if (parts.transportPaise > 0) lines.push({ key: 'rentals.money.transport', paise: parts.transportPaise });
  }
  if (!isResult && (!parts || e.totalPaise !== e.estimatePaise)) {
    lines.push({ key: 'rentals.money.estimate', paise: e.estimatePaise });
  }
  lines.push({ key: 'rentals.money.total', paise: e.totalPaise });
  return lines;
}

/**
 * The Booking record's money block (§14.1): the current version's estimate → the agreed total (from confirmation) →
 * the owner's final amount (at return). `changed`: the final differs from the agreed total (a reason is shown).
 */
export function moneySteps(v: Pick<RentalBookingView, 'current' | 'agreedTotalPaise' | 'finalAmountPaise'>): {
  estimate: number;
  agreed: number | null;
  final: number | null;
  changed: boolean;
} {
  const agreed = v.agreedTotalPaise;
  const final = v.finalAmountPaise;
  return {
    estimate: v.current.estimatePaise,
    agreed,
    final,
    changed: agreed != null && final != null && final !== agreed,
  };
}

/** The buttons the reader may see now (`today` = the IST date, `istDateKey()`): the shared rule. */
export function bookingActionsFor(v: RentalBookingView, today: string): RentalBookingActionKey[] {
  return rentalBookingActions(v, today);
}

/** `YYYY-MM-DD` → [year, month index, day]. */
const parts = (date: string): [number, number, number] => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return [y, m - 1, d];
};

/**
 * A booking's dates in the reader's language: "21 Nov" (one day), "21–23 Nov", "28 Nov – 2 Dec", and with the years
 * when the range crosses one ("28 Dec 2026 – 3 Jan 2027"). Calendar dates, no time zone.
 */
export function dateRangeLabel(start: string, end: string, lang: Language): string {
  const months = monthShortNamesFor(lang);
  const [y1, m1, d1] = parts(start);
  const [y2, m2, d2] = parts(end);
  if (start === end) return `${d1} ${months[m1]}`;
  if (y1 !== y2) return `${d1} ${months[m1]} ${y1} – ${d2} ${months[m2]} ${y2}`;
  if (m1 !== m2) return `${d1} ${months[m1]} – ${d2} ${months[m2]}`;
  return `${d1}–${d2} ${months[m1]}`;
}
