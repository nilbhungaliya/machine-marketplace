import type {
  DealPaymentMethod,
  RentalAvailabilityDay,
  RentalBlockInput,
  RentalBlockView,
  RentalBookingPhotos,
  RentalBookingsPage,
  RentalBookingsQuery,
  RentalBookingView,
  RentalCalendar,
  RentalCancelReason,
  RentalChangeInput,
  RentalDeclineReason,
  RentalDisputeCategory,
  RentalEstimateRequest,
  RentalEstimateResult,
  RentalFinalReason,
  RentalRequestInput,
  ReviewState,
} from '@mpm/shared-types';
import api from './api';

// One typed function per M14 rental route (spec §13.2). Every booking write takes an `Idempotency-Key` the caller makes
// once per tap and reuses on retry (`newIdempotencyKey` in `lib/offers-api.ts`) and answers the reader's fresh
// `RentalBookingView`. Proposal answers name the version they answer (`versionSeq`, `409 RENTAL_BOOKING_STALE`); the
// notes edit names its `version`. Errors are axios errors: map them with `lib/m14-errors.ts`.

const headers = (key: string) => ({ headers: { 'Idempotency-Key': key } });
const data = <T>(p: Promise<{ data: { data: T } }>): Promise<T> => p.then((r) => r.data.data);

// ─── Listing side (public) ───

/** `GET /listings/:id/availability?from&to` (public, R13): free / partial / full per day, never who or how many. */
export function fetchRentalAvailability(
  listingId: string,
  range?: { from?: string; to?: string },
): Promise<RentalAvailabilityDay[]> {
  const params: Record<string, string> = {};
  if (range?.from) params.from = range.from;
  if (range?.to) params.to = range.to;
  return data(api.get(`/listings/${listingId}/availability`, { params }));
}

/** `POST /rentals/estimate` (public): the server's money for these terms; never the distance (§13.2). */
export function estimateRental(input: RentalEstimateRequest): Promise<RentalEstimateResult> {
  return data(api.post('/rentals/estimate', input));
}

// ─── Renter: request ───

/** `POST /listings/:id/bookings` (**I**): a new request (§6.2); opens or reuses the listing's thread. */
export function requestBooking(listingId: string, input: RentalRequestInput, key: string): Promise<RentalBookingView> {
  return data(api.post(`/listings/${listingId}/bookings`, input, headers(key)));
}

// ─── Reads ───

/** `GET /rental-bookings?tab&side&listingId&cursor`: the Deals tab's Rentals list (20 a page, keyset cursor). */
export function fetchRentalBookings(q: RentalBookingsQuery): Promise<RentalBookingsPage> {
  const params: Record<string, string> = { tab: q.tab, side: q.side };
  if (q.listingId) params.listingId = q.listingId;
  if (q.cursor) params.cursor = q.cursor;
  return data(api.get('/rental-bookings', { params }));
}

/** `GET /rental-bookings/:id`: the reader's Booking record (`404 RENTAL_BOOKING_NOT_FOUND` for anyone not a party). */
export function fetchRentalBooking(id: string): Promise<RentalBookingView> {
  return data(api.get(`/rental-bookings/${id}`));
}

/** `GET /rental-bookings/:id/photos`: on-site, return (and problem) photos as 300 s signed URLs (party only). */
export function fetchRentalBookingPhotos(id: string): Promise<RentalBookingPhotos> {
  return data(api.get(`/rental-bookings/${id}/photos`));
}

// ─── Booking actions (§6.1) ───

/** Owner, `requested`: confirm the open version (capacity checked; agreed = its total). */
export function confirmBooking(id: string, body: { versionSeq: number }, key: string): Promise<RentalBookingView> {
  return data(api.post(`/rental-bookings/${id}/confirm`, body, headers(key)));
}

/** Owner on `requested` (with its own `totalPaise`, §6.3) or renter on `countered`: a new version. */
export function proposeBookingChange(id: string, body: RentalChangeInput, key: string): Promise<RentalBookingView> {
  return data(api.post(`/rental-bookings/${id}/change`, body, headers(key)));
}

/** Renter, `countered`: accept the owner's version (capacity checked; agreed = the owner's total). */
export function acceptBookingChange(id: string, body: { versionSeq: number }, key: string): Promise<RentalBookingView> {
  return data(api.post(`/rental-bookings/${id}/accept`, body, headers(key)));
}

/** Owner on `requested`, renter on `countered`. */
export function declineBooking(
  id: string,
  body: { versionSeq: number; reason: RentalDeclineReason },
  key: string,
): Promise<RentalBookingView> {
  return data(api.post(`/rental-bookings/${id}/decline`, body, headers(key)));
}

/** Renter, `requested` / `countered`. */
export function withdrawBooking(id: string, key: string): Promise<RentalBookingView> {
  return data(api.post(`/rental-bookings/${id}/withdraw`, {}, headers(key)));
}

/** Either side, `confirmed`, from `startDate − 1` (`409 RENTAL_TOO_EARLY`): opening hour meter and ≤ 3 photo keys. */
export function markBookingOnSite(
  id: string,
  body: { hourMeter?: number; photoKeys?: string[] },
  key: string,
): Promise<RentalBookingView> {
  return data(api.post(`/rental-bookings/${id}/on-site`, body, headers(key)));
}

/** `POST /rental-bookings/:id/returned` body (§6.4): a final amount ≠ agreed needs `finalReason`. */
export interface RentalReturnInput {
  hourMeter?: number;
  finalAmountPaise: number;
  finalReason?: RentalFinalReason;
  finalNote?: string;
  damageNote?: string;
  photoKeys?: string[];
}

/** Owner, `on_rent`. */
export function markBookingReturned(id: string, body: RentalReturnInput, key: string): Promise<RentalBookingView> {
  return data(api.post(`/rental-bookings/${id}/returned`, body, headers(key)));
}

/** Renter, `returned`: completes the booking (reviews open). */
export function confirmBookingReturn(id: string, key: string): Promise<RentalBookingView> {
  return data(api.post(`/rental-bookings/${id}/confirm-return`, {}, headers(key)));
}

/** Either side, `confirmed` only (§6.5): a reason of the reader's side, an optional note (≤ 300). */
export function cancelBooking(
  id: string,
  body: { reason: RentalCancelReason; note?: string },
  key: string,
): Promise<RentalBookingView> {
  return data(api.post(`/rental-bookings/${id}/cancel`, body, headers(key)));
}

/** Either side, `on_rent` / `returned` (renter until `autoCompleteAt`): goes to support (`disputed`). */
export function reportBookingProblem(
  id: string,
  body: { category: RentalDisputeCategory; description: string; photoKeys?: string[] },
  key: string,
): Promise<RentalBookingView> {
  return data(api.post(`/rental-bookings/${id}/problem`, body, headers(key)));
}

/** `POST /rental-bookings/:id/photos/presign` (party, non-viewer): a signed PUT for one private photo (D8). */
export function presignBookingPhoto(
  id: string,
  body: { contentType: string; contentLength: number },
): Promise<{ url: string; key: string; expiresAt: string }> {
  return data(api.post(`/rental-bookings/${id}/photos/presign`, body));
}

/** `PATCH /rental-bookings/:id/notes` (**I**): only the fields sent change; `version` guards a stale edit. */
export interface RentalNotesPatch {
  version: number;
  paymentMethod?: DealPaymentMethod | null;
  advancePaise?: number | null;
  depositPaise?: number | null;
  depositReturned?: boolean | null;
  /** `HH:MM`. */
  expectedOnSiteTime?: string | null;
  text?: string | null;
}

export function editBookingNotes(id: string, patch: RentalNotesPatch, key: string): Promise<RentalBookingView> {
  return data(api.patch(`/rental-bookings/${id}/notes`, patch, headers(key)));
}

// ─── Reviews (F6 rules with rental facets; reply / report use F6's `/reviews/:id/*`) ───

export function fetchRentalReviewState(id: string): Promise<ReviewState> {
  return data(api.get(`/rental-bookings/${id}/review`));
}

export function submitRentalReview(
  id: string,
  body: { ratings: Record<string, number>; text?: string },
  key: string,
): Promise<ReviewState> {
  return data(api.post(`/rental-bookings/${id}/review`, body, headers(key)));
}

// ─── Owner calendar and blocks (§7.3) ───

/** `GET /listings/:id/calendar?from&to` (owner members): out / free per day, bookings and blocks. */
export function fetchRentalCalendar(listingId: string, range?: { from?: string; to?: string }): Promise<RentalCalendar> {
  const params: Record<string, string> = {};
  if (range?.from) params.from = range.from;
  if (range?.to) params.to = range.to;
  return data(api.get(`/listings/${listingId}/calendar`, { params }));
}

export function createRentalBlock(listingId: string, input: RentalBlockInput): Promise<RentalBlockView> {
  return data(api.post(`/listings/${listingId}/rental-blocks`, input));
}

export function updateRentalBlock(blockId: string, input: RentalBlockInput): Promise<RentalBlockView> {
  return data(api.patch(`/rental-blocks/${blockId}`, input));
}

export function deleteRentalBlock(blockId: string): Promise<unknown> {
  return data(api.delete(`/rental-blocks/${blockId}`));
}
