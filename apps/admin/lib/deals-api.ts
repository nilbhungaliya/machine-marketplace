import type {
  AdminDealDetail, AdminDealList, DealActorSide, DealCancelReason, DealCancelledBy, DealCompletedHow, DealEventCode,
  DealFulfilment, DealPaymentMethod, DealStatus, HoldStatus, PartySide,
} from '@mpm/shared-types';
import { api } from './api';
import type { StatusTone } from './status';

// Typed calls to the admin Deals API (F6 + F7 spec §16.1–§16.2). Read-only; roles support and operations (super_admin
// passes). The detail carries the structured notes only: the free text never leaves the API (`notes.hasText`).

export const ADMIN_DEAL_PAGE_SIZES = [25, 50, 100] as const;

export interface AdminDealQuery {
  status?: DealStatus;
  /** Deal ref (`#123` or digits), business name or listing title. */
  search?: string;
  /** Accepted on or after / on or before, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function fetchAdminDeals(q: AdminDealQuery = {}): Promise<AdminDealList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return api.get<AdminDealList>(`/admin/deals${qs ? `?${qs}` : ''}`);
}

export const fetchAdminDeal = (id: string) => api.get<AdminDealDetail>(`/admin/deals/${id}`);

// ─── formatting ───

/**
 * A paise amount sent as a decimal string (totals, advances: P4) as rupees with Indian grouping, without going through
 * a float: "4200000" → ₹42,000; "1234567" → ₹12,345.67.
 */
export function formatPaiseString(paise: string): string {
  if (!/^-?\d+$/.test(paise)) return '—';
  const value = BigInt(paise);
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const rupees = abs / BigInt(100);
  const rest = abs % BigInt(100);
  const whole = rupees.toLocaleString('en-IN');
  return `${negative ? '-' : ''}₹${whole}${rest === BigInt(0) ? '' : `.${rest.toString().padStart(2, '0')}`}`;
}

/** `#100123`, the deal reference both parties quote. */
export const formatDealRef = (ref: number) => `#${ref}`;

// ─── wording ───

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  agreed: 'Agreed',
  handed_over: 'Handed over',
  disputed: 'Disputed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Badge colours: the shared map has no `handed_over` (in progress, lavender). */
export const DEAL_STATUS_TONES: Record<DealStatus, StatusTone> = {
  agreed: 'green', handed_over: 'blue', disputed: 'amber', completed: 'green', cancelled: 'red',
};

/** The list's status tabs, in the order of §16.1. */
export const DEAL_STATUS_TABS: DealStatus[] = ['agreed', 'handed_over', 'disputed', 'completed', 'cancelled'];

export const PAYMENT_METHOD_LABELS: Record<DealPaymentMethod, string> = {
  bank: 'Bank transfer',
  upi: 'UPI',
  cash: 'Cash',
  credit: 'Credit',
};

export const FULFILMENT_LABELS: Record<DealFulfilment, string> = {
  pickup: 'Buyer picks up',
  delivery: 'Seller delivers',
};

export const COMPLETED_HOW_LABELS: Record<DealCompletedHow, string> = {
  buyer_confirmed: 'Buyer confirmed receipt',
  auto: 'Completed automatically after handover',
  support: 'Closed as completed by support',
};

export const CANCELLED_BY_LABELS: Record<DealCancelledBy, string> = {
  buyer: 'the buyer',
  seller: 'the seller',
  both: 'both sides',
  system: 'the system',
};

export const CANCEL_REASON_LABELS: Record<DealCancelReason, string> = {
  no_longer_needed: 'No longer needed',
  found_elsewhere: 'Found elsewhere',
  seller_not_responding: 'Seller not responding',
  buyer_not_responding: 'Buyer not responding',
  payment_not_received: 'Payment not received',
  stock_problem: 'Stock problem',
  other: 'Other',
  listing_removed: 'Listing removed',
  support_closed: 'Closed by support',
};

export const HOLD_STATUS_LABELS: Record<HoldStatus, string> = {
  active: 'Held for this deal',
  converted: 'Sold (taken from stock)',
  released: 'Released back to stock',
};

export const DEAL_EVENT_LABELS: Record<DealEventCode, string> = {
  agreed: 'Deal agreed',
  notes_changed: 'Deal notes changed',
  handed_over: 'Handed over',
  received: 'Buyer confirmed receipt',
  auto_completed: 'Completed automatically',
  cancel_requested: 'Cancel requested',
  cancel_request_withdrawn: 'Cancel request cleared',
  cancelled: 'Cancelled',
  problem_reported: 'Problem reported',
  dispute_resolved: 'Dispute resolved',
  contact_shared: 'Contact number shared',
};

export const ACTOR_SIDE_LABELS: Record<DealActorSide, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  system: 'System',
  support: 'Support',
};

export const PARTY_SIDE_LABELS: Record<PartySide, string> = { buyer: 'Buyer', seller: 'Seller' };
