import {
  LISTING_FLAGS, LISTING_KINDS, LISTING_STATUSES, PART_SIDES, ADMIN_LISTING_PAGE_SIZES,
  type AdminListingBulkRequest, type AdminListingBulkResult, type AdminListingDetail, type AdminListingFilters,
  type AdminListingList, type AdminListingPageSize, type AdminListingPatch, type AdminMediaDeleteResult,
  type AdminModerationQueue, type AdminListingAction, type DeliveryOption, type GstPriceMode, type ListingFlag,
  type ListingKind, type ListingReportReason, type ListingScoreItem, type ListingStatus, type ModerationCounts,
  type ModerationTab, type PartSide, type PriceModel, type RentalFuel, type RentalOperator, type RentalPeriod,
  type RentalTransport, type ReportResolution, type ReviewReason, type ListingActor, type EffectiveTemplate,
} from '@mpm/shared-types';
import { api, ApiError } from './api';
import { formatCurrency } from './utils';

// Typed calls to the listing moderation API (F2 spec §11, plan Task 16). Each returns the endpoint's `data`.
// Roles: moderation and every action `moderator`; the all-listings list and the detail also `support` (read only).

// ─── reads ───

/** `GET /admin/moderation/queue?tab=&page=`: Review oldest first, Reported most reports first, Decided newest first. */
export const fetchModerationQueue = (tab: ModerationTab, page = 1) =>
  api.get<AdminModerationQueue>(`/admin/moderation/queue?tab=${tab}&page=${page}`);

export const fetchModerationCounts = () => api.get<ModerationCounts>('/admin/moderation/counts');

/** The nav badge `moderationWaiting`: listings waiting for review plus listings with open reports (§11.1). */
export const fetchModerationWaiting = async () => {
  const counts = await fetchModerationCounts();
  return counts.review + counts.reported;
};

/** The query string of `GET /admin/listings` (and of the page's URL): lists comma-separated, `reported=1`. */
export function listingsQuery(f: AdminListingFilters): string {
  const params = new URLSearchParams();
  if (f.status?.length) params.set('status', f.status.join(','));
  if (f.kind) params.set('kind', f.kind);
  if (f.machineCategoryId) params.set('machineCategoryId', f.machineCategoryId);
  if (f.city) params.set('city', f.city);
  if (f.side) params.set('side', f.side);
  if (f.flags?.length) params.set('flags', f.flags.join(','));
  if (f.reported) params.set('reported', '1');
  if (f.businessId) params.set('businessId', f.businessId);
  if (f.q) params.set('q', f.q);
  if (f.page && f.page > 1) params.set('page', String(f.page));
  if (f.pageSize) params.set('pageSize', String(f.pageSize));
  return params.toString();
}

export function fetchAdminListings(filters: AdminListingFilters = {}): Promise<AdminListingList> {
  const qs = listingsQuery(filters);
  return api.get<AdminListingList>(`/admin/listings${qs ? `?${qs}` : ''}`);
}

/** The URL's raw strings (the page's `useUrlState`) as filters; unknown values are dropped. */
export function filtersFromUrl(raw: Partial<Record<keyof AdminListingFilters, string>>): AdminListingFilters {
  const list = <T extends string>(value: string | undefined, allowed: readonly T[]) =>
    (value ?? '').split(',').filter((v): v is T => (allowed as readonly string[]).includes(v));
  const one = <T extends string>(value: string | undefined, allowed: readonly T[]) =>
    (allowed as readonly string[]).includes(value ?? '') ? (value as T) : undefined;
  const out: AdminListingFilters = {};
  const status = list<ListingStatus>(raw.status, LISTING_STATUSES);
  if (status.length) out.status = status;
  const kind = one<ListingKind>(raw.kind, LISTING_KINDS);
  if (kind) out.kind = kind;
  if (raw.machineCategoryId && isUuid(raw.machineCategoryId)) out.machineCategoryId = raw.machineCategoryId;
  const city = raw.city?.trim();
  if (city) out.city = city;
  const side = one<PartSide>(raw.side, PART_SIDES);
  if (side) out.side = side;
  const flags = list<ListingFlag>(raw.flags, LISTING_FLAGS);
  if (flags.length) out.flags = flags;
  if (raw.reported === '1') out.reported = true;
  if (raw.businessId && isUuid(raw.businessId)) out.businessId = raw.businessId;
  const q = raw.q?.trim();
  if (q) out.q = q;
  const page = Number(raw.page);
  if (Number.isInteger(page) && page >= 1) out.page = page;
  const size = Number(raw.pageSize);
  if ((ADMIN_LISTING_PAGE_SIZES as readonly number[]).includes(size)) out.pageSize = size as AdminListingPageSize;
  return out;
}

export const fetchAdminListing = (id: string) => api.get<AdminListingDetail>(`/admin/listings/${id}`);

// ─── actions (each answers the refreshed `AdminListingDetail`, except media delete and bulk) ───

/** Approve, ask for changes, reject and edit send the version as loaded: `409 LISTING_CHANGED` after a seller edit (R53). */
export const approveListing = (id: string, version: number) =>
  api.post<AdminListingDetail>(`/admin/listings/${id}/approve`, { version });

export const askForChanges = (id: string, version: number, message: string) =>
  api.post<AdminListingDetail>(`/admin/listings/${id}/ask-for-changes`, { version, message });

export const rejectListing = (id: string, version: number, reason: string) =>
  api.post<AdminListingDetail>(`/admin/listings/${id}/reject`, { version, reason });

/** Hide, unhide and remove never send a version: they always apply (R53). */
export const hideListing = (id: string, reason: string) =>
  api.post<AdminListingDetail>(`/admin/listings/${id}/hide`, { reason });

export const unhideListing = (id: string) => api.post<AdminListingDetail>(`/admin/listings/${id}/unhide`);

export const removeListing = (id: string, reason: string) =>
  api.post<AdminListingDetail>(`/admin/listings/${id}/remove`, { reason });

/** Category, side or fit: `400 SPECS_INVALID` when the specs don't fit the new category (R33). */
export const editListing = (id: string, patch: AdminListingPatch) =>
  api.patch<AdminListingDetail>(`/admin/listings/${id}`, patch);

/** One photo or video, with the reason. Deleting the last photo moves a public-side listing to `rejected` (R52). */
export const deleteListingMedia = (id: string, mediaId: string, reason: string) =>
  api.delete<AdminMediaDeleteResult>(`/admin/listings/${id}/media/${mediaId}`, { reason });

/** Closes every open report of the listing; `409 NO_OPEN_REPORTS` when none. */
export const resolveReports = (id: string, outcome: ReportResolution, note: string | null) =>
  api.post<AdminListingDetail>(`/admin/listings/${id}/reports/resolve`, { outcome, note });

export const bulkListings = (request: AdminListingBulkRequest) =>
  api.post<AdminListingBulkResult>('/admin/listings/bulk', request);

// ─── wording ───

export const LISTING_CHANGED_MESSAGE = 'The seller changed this listing while you were looking. Reload it before you decide.';
export const NO_PHOTO_MESSAGE = 'This listing has no photo';
/** Shown after a media delete answered `purge: 'failed'`. */
export const PURGE_FAILED_MESSAGE = 'Deleted. The CDN copy may take a while to clear.';

const ERROR_WORDS: Record<string, string> = {
  LISTING_CHANGED: LISTING_CHANGED_MESSAGE,
  LISTING_INCOMPLETE: NO_PHOTO_MESSAGE,
  NO_OPEN_REPORTS: 'This listing has no open reports any more',
  LISTING_TRANSITION_NOT_ALLOWED: "This listing's status changed: that action isn't possible now",
  SPECS_INVALID: "The listing's specifications don't fit that category",
  LISTING_NOT_FOUND: 'This listing no longer exists',
  MEDIA_NOT_FOUND: 'That photo or video was already deleted',
  STORAGE_UNAVAILABLE: "Media storage isn't set up, so media can't be deleted",
  RENTAL_NEEDS_GST: "The seller's GST verification is gone: a machine for rent can't go live without it",
};

/** A bulk action's skipped row says why in its own terms. */
const SKIP_WORDS: Record<string, string> = {
  LISTING_TRANSITION_NOT_ALLOWED: "Can't be hidden or removed in its status",
};

/** Codes the action bar shows as a refusal beside the buttons (the listing stays as it was). */
export const REFUSAL_CODES: readonly string[] = ['LISTING_INCOMPLETE', 'RENTAL_NEEDS_GST'];

/** An error code in words (a bulk action's skipped row); the code itself when unknown. */
export const codeWords = (code: string) => SKIP_WORDS[code] ?? ERROR_WORDS[code] ?? code;

/** The message an admin reads for a failed call; the API's own wording otherwise. */
export function explainListingError(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError && err.code === 'SPECS_INVALID' && err.details && Object.keys(err.details).length > 0) {
    // `details` maps each refusing field key to its code (the A4 validator's errors).
    return `${ERROR_WORDS.SPECS_INVALID}: ${Object.keys(err.details).join(', ')}`;
  }
  if (err instanceof ApiError && err.code && ERROR_WORDS[err.code]) return ERROR_WORDS[err.code];
  return err instanceof Error && err.message ? err.message : fallback;
}

/** A uuid, as every listing, business and category id is; other values in a URL are dropped. */
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Integer paise as rupees, Indian grouping: 4200000 → ₹42,000. */
export const formatPaise = (paise: number) => formatCurrency(paise / 100);

/** `#100123`, the reference sellers and buyers quote (§4.8). */
export const formatRef = (ref: number) => `#${ref}`;

export const KIND_LABELS: Record<ListingKind, string> = {
  part: 'Part',
  machine: 'Machine for sale',
  machine_rental: 'Machine for rent',
};

export const SIDE_LABELS: Record<PartSide, string> = {
  left: 'Left',
  right: 'Right',
  pair: 'Pair',
  not_applicable: 'No side',
};

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  unverified_seller: 'Unverified seller',
  first_listings: 'First listing',
  resubmitted: 'Resubmitted',
  price_check: 'Price check',
  unit_check: 'Unit check',
  quantity_check: 'Quantity check',
  edited_after_report: 'Edited after report',
  edit_flagged: 'Edit flagged',
};

export const FLAG_LABELS: Record<ListingFlag, string> = {
  price_check: 'Price check',
  unit_check: 'Unit check',
  quantity_check: 'Quantity check',
};

export const REPORT_REASON_LABELS: Record<ListingReportReason, string> = {
  stock_photos: 'Stock or copied photos',
  wrong_side_or_fit: 'Wrong side or fit',
  wrong_price_or_quantity: 'Wrong price or quantity',
  already_sold: 'Already sold',
  advance_payment: 'Asked for advance payment',
  something_else: 'Something else',
};

export const ADMIN_ACTION_LABELS: Record<AdminListingAction, string> = {
  approve: 'Approved',
  ask_for_changes: 'Asked for changes',
  reject: 'Rejected',
  hide: 'Hidden',
  unhide: 'Unhidden',
  remove: 'Removed',
};

export const MODERATION_TAB_LABELS: Record<ModerationTab, string> = {
  review: 'Review',
  reported: 'Reported',
  decided: 'Decided',
};

export const PRICE_MODEL_LABELS: Record<PriceModel, string> = {
  fixed: 'Fixed',
  negotiable: 'Negotiable',
  on_request: 'Price on request',
};

export const GST_MODE_LABELS: Record<GstPriceMode, string> = { included: 'GST included', extra: '+ GST' };

export const RENTAL_PERIOD_LABELS: Record<RentalPeriod, string> = { hour: 'hour', day: 'day', week: 'week', month: 'month' };

export const DELIVERY_LABELS: Record<DeliveryOption, string> = {
  pickup: 'Buyer picks up',
  ship: 'Seller ships',
  local_delivery: 'Local delivery',
};

export const OPERATOR_LABELS: Record<RentalOperator, string> = {
  included: 'Operator included',
  optional: 'Operator optional',
  not_available: 'No operator',
  mandatory: 'Operator mandatory',
};

export const FUEL_LABELS: Record<RentalFuel, string> = {
  client: 'Client supplies fuel',
  included: 'Fuel included',
  per_litre: 'Fuel charged per litre',
};

export const TRANSPORT_LABELS: Record<RentalTransport, string> = {
  owner_delivers: 'Owner delivers',
  renter_picks_up: 'Renter picks up',
  either: 'Either',
};

export const ACTOR_LABELS: Record<ListingActor, string> = { seller: 'Seller', admin: 'Moderator', system: 'System' };

export const SCORE_ITEM_LABELS: Record<ListingScoreItem, string> = {
  photos: '3 photos',
  video: 'a video',
  part_number: 'part number',
  fitment: 'what it fits',
  year: 'year',
  hours_run: 'hours run',
  optional_specs: 'optional specs',
  description: 'description',
};

/** A transition's `action` as the history shows it. */
export function historyActionLabel(action: string): string {
  const known: Record<string, string> = {
    publish: 'Published', approve: 'Approved', ask_for_changes: 'Asked for changes', reject: 'Rejected', pause: 'Paused',
    resume: 'Resumed', renew: 'Renewed', mark_sold: 'Marked sold', mark_unavailable: 'Marked unavailable',
    relist: 'Relisted', mark_rented: 'Marked on rent', end_rental: 'Rental ended', remove: 'Removed', expire: 'Expired',
    back_to_review: 'Back to review after an edit', hide: 'Hidden', unhide: 'Unhidden',
    photos_removed: 'Last photo deleted by a moderator', reserve: 'Reserved', unreserve: 'Unreserved',
    // M14 §7.1: a rental's status follows its bookings (the retired mark_rented / end_rental labels stay for history).
    rent_out: 'On rent (booking)', rent_back: 'Back from rent (booking)',
  };
  return known[action] ?? action.replace(/_/g, ' ');
}

/** The category's field template (public A4 read), for spec labels on the review screen. */
export const fetchListingTemplate = (categoryId: string, kind: ListingKind) =>
  api.get<EffectiveTemplate>(`/categories/${categoryId}/template?kind=${kind === 'part' ? 'part' : 'machine'}`);
