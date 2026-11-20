import {
  RENTAL_BOOKING_STATUSES,
  type AdminRentalBookingDetail, type AdminRentalBookingList, type RentalActorSide, type RentalBlockReason,
  type RentalBookingStatus, type RentalCancelReason, type RentalCompletedHow, type RentalDeclineReason,
  type RentalEventCode, type RentalFinalReason, type RentalSystemReason, type RentalTurn,
} from '@mpm/shared-types';
import { api, ApiError } from './api';

// Typed calls to the admin Rental bookings API (M14 spec §15, R15; lane A3's `routes/admin/rentals.ts`). Roles
// operations and support (super_admin passes). Each returns the endpoint's `data`. Version messages, notes and the
// damage / final / cancel notes arrive masked; the site address is as stored (staff, my call 11): never cache it.

export const ADMIN_RENTAL_PAGE_SIZES = [25, 50, 100] as const;

/** `GET /admin/rental-bookings` filters. `from` / `to` bound the start date (IST calendar days, inclusive). */
export interface AdminRentalQuery {
  status?: RentalBookingStatus;
  from?: string;
  to?: string;
  /** Renter or owner. */
  businessId?: string;
  listingId?: string;
  /** A booking ref (`700001` / `#700001`), else a business name or the listing title. */
  q?: string;
  page?: number;
  pageSize?: number;
}

/** The query string of `GET /admin/rental-bookings`; empty filters are dropped (page 1 too). */
export function adminRentalsQuery(f: AdminRentalQuery): string {
  const params = new URLSearchParams();
  if (f.status) params.set('status', f.status);
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.businessId) params.set('businessId', f.businessId);
  if (f.listingId) params.set('listingId', f.listingId);
  const q = f.q?.trim();
  if (q) params.set('q', q);
  if (f.page && f.page > 1) params.set('page', String(f.page));
  if (f.pageSize) params.set('pageSize', String(f.pageSize));
  return params.toString();
}

export function fetchAdminRentals(f: AdminRentalQuery = {}): Promise<AdminRentalBookingList> {
  const qs = adminRentalsQuery(f);
  return api.get<AdminRentalBookingList>(`/admin/rental-bookings${qs ? `?${qs}` : ''}`);
}

export const fetchAdminRental = (id: string) => api.get<AdminRentalBookingDetail>(`/admin/rental-bookings/${id}`);

/** `requested` / `countered` / `confirmed` → `cancelled` (audit `rental_booking.cancel`). Answers the refreshed detail. */
export const cancelRentalBooking = (id: string, body: { reason: string }) =>
  api.post<AdminRentalBookingDetail>(`/admin/rental-bookings/${id}/cancel`, body);

/** The statuses an admin may cancel from (§6.1): once the machine is on site only a dispute settles a booking. */
export const ADMIN_CANCELLABLE: readonly RentalBookingStatus[] = ['requested', 'countered', 'confirmed'];

// ─── the list page's URL ───

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: string) => DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The page's URL values (all strings, '' = unset). */
export interface RentalUrl {
  q: string;
  status: string;
  from: string;
  to: string;
  businessId: string;
  listingId: string;
  page: string;
  pageSize: string;
}

/** The URL's strings as the API query; unknown values are dropped. Days stay calendar days (the API's start date). */
export function queryFromUrl(url: RentalUrl): AdminRentalQuery {
  const q: AdminRentalQuery = { page: Number(url.page) || 1, pageSize: Number(url.pageSize) || 25 };
  if ((RENTAL_BOOKING_STATUSES as readonly string[]).includes(url.status)) q.status = url.status as RentalBookingStatus;
  if (isDay(url.from)) q.from = url.from;
  if (isDay(url.to)) q.to = url.to;
  if (isUuid(url.businessId)) q.businessId = url.businessId;
  if (isUuid(url.listingId)) q.listingId = url.listingId;
  if (url.q.trim()) q.q = url.q.trim();
  return q;
}

// ─── formatting and wording ───

/** "#700001": the reference support quotes ("Booking #700001"). */
export const formatBookingRef = (ref: number | null) => (ref === null ? '—' : `#${ref}`);

/** A calendar day (`YYYY-MM-DD`) in words, read at noon UTC so no timezone moves it to the day before. */
export function formatDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "3 Dec 2026 → 9 Dec 2026", or one day. */
export const formatDayRange = (start: string, end: string) =>
  (start === end ? formatDay(start) : `${formatDay(start)} → ${formatDay(end)}`);

export const RENTAL_PERIOD_WORDS: Record<'hour' | 'day' | 'week' | 'month', [string, string]> = {
  hour: ['hour', 'hours'],
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
};

export const RENTAL_ACTOR_LABELS: Record<RentalActorSide, string> = {
  renter: 'Renter',
  owner: 'Owner',
  system: 'System',
  admin: 'Support',
};

export const RENTAL_TURN_LABELS: Record<RentalTurn, string> = {
  owner: "Owner's turn to answer",
  renter: "Renter's turn to answer",
};

export const RENTAL_COMPLETED_HOW_LABELS: Record<RentalCompletedHow, string> = {
  renter_confirmed: 'Renter confirmed the return',
  auto: 'Completed by itself after the return',
  support: 'Closed by support',
};

export const RENTAL_CANCEL_REASON_LABELS: Record<RentalCancelReason, string> = {
  plans_changed: 'Plans changed',
  found_another: 'Found another machine',
  owner_not_responding: 'Owner not responding',
  machine_unavailable: 'Machine unavailable',
  breakdown: 'Machine broke down',
  renter_not_responding: 'Renter not responding',
  other: 'Other',
  listing_removed: 'Listing removed',
  blocked: 'Blocked between the businesses',
  owner_inactive: 'Owner suspended',
  owner_gst: 'Owner lost GST verification',
  renter_inactive: 'Renter suspended',
  support_closed: 'Closed by support (dispute)',
  admin: 'Cancelled by an admin',
};

export const RENTAL_DECLINE_REASON_LABELS: Record<RentalDeclineReason | RentalSystemReason, string> = {
  dates_unavailable: 'Dates not available',
  site_too_far: 'Site too far',
  terms: "Terms don't suit",
  other: 'Other',
  listing_removed: 'Listing removed',
  blocked: 'Blocked between the businesses',
  owner_inactive: 'Owner suspended',
  owner_gst: 'Owner lost GST verification',
  renter_inactive: 'Renter suspended',
  support_closed: 'Closed by support',
  admin: 'Cancelled by an admin',
};

export const RENTAL_FINAL_REASON_LABELS: Record<RentalFinalReason, string> = {
  extra_time: 'Extra time',
  overtime: 'Overtime',
  fuel: 'Fuel',
  transport: 'Transport',
  damage: 'Damage',
  discount: 'Discount',
  other: 'Other',
};

export const RENTAL_BLOCK_REASON_LABELS: Record<RentalBlockReason, string> = {
  maintenance: 'Maintenance',
  booked_outside: 'Booked outside the app',
  other: 'Other',
};

export const RENTAL_EVENT_LABELS: Record<RentalEventCode, string> = {
  requested: 'Booking requested',
  changed_by_owner: 'Owner proposed a change',
  changed_by_renter: 'Renter proposed a change',
  confirmed: 'Owner confirmed',
  change_accepted: 'Change accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  expired: 'Expired unanswered',
  on_site: 'Machine on site',
  returned: 'Machine returned',
  return_confirmed: 'Return confirmed',
  auto_completed: 'Completed by itself',
  cancelled: 'Cancelled',
  problem_reported: 'Problem reported',
  dispute_resolved: 'Dispute resolved',
  notes_changed: 'Notes changed',
  contact_shared: 'Contact numbers shared',
};

const ERROR_WORDS: Record<string, string> = {
  RENTAL_BOOKING_NOT_FOUND: 'This booking no longer exists',
  RENTAL_TRANSITION_NOT_ALLOWED: "This booking's status changed: it can't be cancelled now",
};

/** Codes that mean the page is out of date: reload it. */
const STALE_CODES = ['RENTAL_BOOKING_NOT_FOUND', 'RENTAL_TRANSITION_NOT_ALLOWED'];

/** A failed cancel in words, and whether the page should reload. */
export function explainRentalError(err: unknown): { message: string; stale: boolean } {
  if (err instanceof ApiError) {
    const code = err.code ?? '';
    return { message: ERROR_WORDS[code] ?? (err.message || 'Something went wrong'), stale: STALE_CODES.includes(code) };
  }
  return { message: err instanceof Error && err.message ? err.message : 'Something went wrong', stale: false };
}
