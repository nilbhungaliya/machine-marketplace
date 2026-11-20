import type {
  AdminDisputeDetail, AdminDisputeList, DisputeCategory, DisputeOutcome, DisputeStatus, DisputeSubject, PartySide,
  RentalDisputeCategory,
} from '@mpm/shared-types';
import { api, ApiError } from './api';
import type { StatusTone } from './status';

// Typed calls to the admin Disputes API (F6 + F7 spec §9.6, §16.1–§16.2; M14 R12: deal and rental booking disputes
// share the queue). Role: support (super_admin passes).

export interface DisputeListQuery {
  status?: DisputeStatus;
  page?: number;
  pageSize?: number;
}

/** Open first, oldest first; resolved after, newest first (the API orders). */
export function fetchDisputes(q: DisputeListQuery = {}): Promise<AdminDisputeList> {
  const params = new URLSearchParams();
  if (q.status) params.set('status', q.status);
  if (q.page && q.page > 1) params.set('page', String(q.page));
  if (q.pageSize) params.set('pageSize', String(q.pageSize));
  const qs = params.toString();
  return api.get<AdminDisputeList>(`/admin/disputes${qs ? `?${qs}` : ''}`);
}

/** The nav badge `disputesOpen`. */
export const fetchOpenDisputeCount = async () => (await api.get<{ open: number }>('/admin/disputes/count')).open;

export const fetchDispute = (id: string) => api.get<AdminDisputeDetail>(`/admin/disputes/${id}`);

/** `POST /admin/disputes/:id/resolve` (§9.6). `stockReturned` only (and always) with `cancelled`. */
export interface ResolveDisputeBody {
  outcome: DisputeOutcome;
  stockReturned?: boolean;
  internalNote: string;
  messageToParties?: string | null;
}

export const resolveDispute = (id: string, body: ResolveDisputeBody) =>
  api.post<AdminDisputeDetail>(`/admin/disputes/${id}/resolve`, body);

// ─── wording ───

/** Deal and rental-booking problem categories (M14 §9: a booking's dispute shares the queue). */
export const DISPUTE_CATEGORY_LABELS: Record<DisputeCategory | RentalDisputeCategory, string> = {
  not_as_described: 'Not as described',
  damaged: 'Damaged',
  short_quantity: 'Short quantity',
  not_received: 'Not received',
  payment_not_received: 'Payment not received',
  breakdown: 'Machine broke down',
  damage: 'Machine damaged',
  hours_or_amount: 'Hours or amount',
  no_show: 'Machine not delivered',
  other: 'Something else',
};

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = { open: 'Open', resolved: 'Resolved' };
export const DISPUTE_STATUS_TONES: Record<DisputeStatus, StatusTone> = { open: 'amber', resolved: 'green' };

export const DISPUTE_OUTCOME_LABELS: Record<DisputeOutcome, { label: string; hint: string }> = {
  completed: { label: 'Close as completed', hint: 'The goods count as sold: the held stock is taken from the listing.' },
  cancelled: { label: 'Close as cancelled', hint: 'The deal ends. You say below whether the goods went back to the seller.' },
  resumed: { label: 'Resume the deal', hint: 'The deal goes back to handed over and its timers start again.' },
};

/** A rental booking dispute's outcomes (M14 R12): no stock moves, so no goods question. */
export const RENTAL_DISPUTE_OUTCOME_LABELS: Record<DisputeOutcome, { label: string; hint: string }> = {
  completed: {
    label: 'Close as completed',
    hint: "The booking completes at the owner's final amount, or the agreed total when none was set. Reviews open.",
  },
  cancelled: { label: 'Close as cancelled', hint: 'The booking is closed by support and ends without completing.' },
  resumed: { label: 'Resume the booking', hint: 'The booking goes back to where it was before the problem (on rent or returned).' },
};

/** Short form for tables and history. */
export const DISPUTE_OUTCOME_SHORT: Record<DisputeOutcome, string> = {
  completed: 'Completed',
  cancelled: 'Cancelled',
  resumed: 'Resumed',
};

/** What a dispute is about, in words and as a link: "Deal #500001" → Deals, "Booking #700001" → Rental bookings. */
export function disputeSubject(d: {
  subject?: DisputeSubject;
  dealId: string | null;
  dealRef: number | null;
  rentalBookingRef?: number | null;
}): { kind: 'deal' | 'rental'; noun: string; ref: string; href: string | null } {
  if (d.subject?.kind === 'rental') {
    return {
      kind: 'rental',
      noun: 'booking',
      ref: d.rentalBookingRef != null ? `#${d.rentalBookingRef}` : '—',
      href: `/rentals/${d.subject.rentalBookingId}/`,
    };
  }
  return { kind: 'deal', noun: 'deal', ref: d.dealRef !== null ? `#${d.dealRef}` : '—', href: d.dealId ? `/deals/${d.dealId}/` : null };
}

/** The two sides' names per subject: a booking's buyer is the renter and its seller the owner. */
export function disputePartyLabels(kind: 'deal' | 'rental'): Record<PartySide, string> {
  return kind === 'rental' ? { buyer: 'Renter', seller: 'Owner' } : { buyer: 'Buyer', seller: 'Seller' };
}

const ERROR_WORDS: Record<string, string> = {
  DISPUTE_NOT_OPEN: 'This dispute was already resolved. Reload to see the outcome.',
  DEAL_TRANSITION_NOT_ALLOWED: "The deal's status changed: that outcome isn't possible now. Reload and try again.",
  RENTAL_TRANSITION_NOT_ALLOWED: "The booking's status changed: that outcome isn't possible now. Reload and try again.",
  NOT_FOUND: 'This dispute no longer exists',
};

/** The message an admin reads for a failed resolve, and whether the record is stale (reload). */
export function explainDisputeError(err: unknown): { message: string; stale: boolean } {
  if (err instanceof ApiError && err.code && ERROR_WORDS[err.code]) {
    return { message: ERROR_WORDS[err.code], stale: err.status === 409 || err.status === 404 };
  }
  return { message: err instanceof Error && err.message ? err.message : 'Could not resolve the dispute', stale: false };
}
