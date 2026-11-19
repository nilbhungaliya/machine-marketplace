import type {
  AdminEnquiryDetail, AdminEnquiryList, EnquiryStatus, ListingKind, OfferCloseReason, OfferKind, OfferStatus,
} from '@mpm/shared-types';
import { api } from './api';
import type { StatusTone } from './status';

// Typed calls to the admin Enquiries & offers API (F6 + F7 spec §16.1–§16.2). Read-only and without any message or
// note text; roles support and operations (super_admin passes).

export const ADMIN_ENQUIRY_PAGE_SIZES = [25, 50, 100] as const;

export interface AdminEnquiryQuery {
  enquiryStatus?: EnquiryStatus;
  /** The status of the thread's latest offer. */
  offerStatus?: OfferStatus;
  kind?: ListingKind;
  /** Threads created on or after / before, ISO date-times. */
  from?: string;
  to?: string;
  /** Buyer or seller business name. */
  q?: string;
  page?: number;
  pageSize?: number;
}

export function enquiriesQuery(q: AdminEnquiryQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) {
    if (value === undefined || value === '') continue;
    if (key === 'page' && value === 1) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function fetchAdminEnquiries(q: AdminEnquiryQuery = {}): Promise<AdminEnquiryList> {
  const qs = enquiriesQuery(q);
  return api.get<AdminEnquiryList>(`/admin/enquiries${qs ? `?${qs}` : ''}`);
}

export const fetchAdminEnquiry = (threadId: string) => api.get<AdminEnquiryDetail>(`/admin/enquiries/${threadId}`);

/**
 * A `YYYY-MM-DD` date from the page's filter as the API's ISO bound: the start of that day for `from`, the end of it for
 * `to` (India time, +05:30, the marketplace's day).
 */
export function dayBound(day: string, edge: 'from' | 'to'): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  return edge === 'from' ? `${day}T00:00:00+05:30` : `${day}T23:59:59.999+05:30`;
}

// ─── wording ───

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  open: 'Open',
  replied: 'Replied',
  converted: 'Deal made',
  closed: 'Closed',
};

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  pending: 'Pending',
  countered: 'Countered',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
  backup: 'Backup',
  closed: 'Closed by the system',
};

/** A backup waits on stock (amber); the shared map has no `backup`. */
export const OFFER_STATUS_TONES: Partial<Record<OfferStatus, StatusTone>> = { backup: 'amber', closed: 'gray' };

export const OFFER_KIND_LABELS: Record<OfferKind, string> = {
  offer: 'Offer',
  buy_now: 'Buy at asking price',
  quote: 'Seller quote',
};

export const OFFER_CLOSE_REASON_LABELS: Record<OfferCloseReason, string> = {
  listing_unavailable: 'Listing no longer available',
  listing_changed: 'Listing changed',
  blocked: 'A business blocked the other',
  account_inactive: 'Account suspended',
};
