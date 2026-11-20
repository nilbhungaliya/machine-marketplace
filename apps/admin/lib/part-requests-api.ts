import {
  PART_REQUEST_KINDS, PART_REQUEST_STATUSES,
  type AdminPartRequestDetail, type AdminPartRequestList, type PartRequestAudience, type PartRequestCloseReason,
  type PartRequestDropReason, type PartRequestKind, type PartRequestMatchTier, type PartRequestPhotos,
  type PartRequestReach, type PartRequestReplyStatus, type PartRequestReportReason, type PartRequestStatus,
} from '@mpm/shared-types';
import { api, ApiError } from './api';

// Typed calls to the admin Part requests API (F8 spec §14; lane A3's routes). Roles moderator and support (super_admin
// passes). Each returns the endpoint's `data`. The API masks the request name, note and reply messages for staff too.

export const ADMIN_PART_REQUEST_PAGE_SIZES = [25, 50, 100] as const;

/** `GET /admin/part-requests` filters. `from` / `to` are ISO datetimes with an offset; `to` is exclusive. */
export interface AdminPartRequestQuery {
  status?: PartRequestStatus;
  kind?: PartRequestKind;
  /** A machine category (root): requests anywhere under it. */
  machineCategoryId?: string;
  /** true: with an open (or reviewing) report; false: without one. */
  reported?: boolean;
  businessId?: string;
  from?: string;
  to?: string;
  /** The buyer business's name, or its owner's phone. */
  q?: string;
  page?: number;
  pageSize?: number;
}

/** The query string of `GET /admin/part-requests`; empty filters are dropped (page 1 too). */
export function adminPartRequestsQuery(f: AdminPartRequestQuery): string {
  const params = new URLSearchParams();
  if (f.status) params.set('status', f.status);
  if (f.kind) params.set('kind', f.kind);
  if (f.machineCategoryId) params.set('machineCategoryId', f.machineCategoryId);
  if (f.reported !== undefined) params.set('reported', f.reported ? 'true' : 'false');
  if (f.businessId) params.set('businessId', f.businessId);
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  const q = f.q?.trim();
  if (q) params.set('q', q);
  if (f.page && f.page > 1) params.set('page', String(f.page));
  if (f.pageSize) params.set('pageSize', String(f.pageSize));
  return params.toString();
}

export function fetchAdminPartRequests(f: AdminPartRequestQuery = {}): Promise<AdminPartRequestList> {
  const qs = adminPartRequestsQuery(f);
  return api.get<AdminPartRequestList>(`/admin/part-requests${qs ? `?${qs}` : ''}`);
}

export const fetchAdminPartRequest = (id: string) => api.get<AdminPartRequestDetail>(`/admin/part-requests/${id}`);

/** The reference photos as 300 s signed URLs: fetched when the admin opens them, never kept. */
export const fetchAdminPartRequestPhotos = (id: string) => api.get<PartRequestPhotos>(`/admin/part-requests/${id}/photos`);

/** Any status but `removed` → `removed` (audit `part_request.remove`). Answers the refreshed detail. */
export const removePartRequest = (id: string, body: { reason: string }) =>
  api.post<AdminPartRequestDetail>(`/admin/part-requests/${id}/remove`, body);

/** `removed` → the status it had (audit `part_request.restore`). Answers the refreshed detail. */
export const restorePartRequest = (id: string, body: { reason: string }) =>
  api.post<AdminPartRequestDetail>(`/admin/part-requests/${id}/restore`, body);

// ─── the list page's URL ───

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: string) => DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The start of a `YYYY-MM-DD` day in India time (the marketplace's day), as the API's ISO bound. */
export const dayStart = (day: string) => `${day}T00:00:00+05:30`;

/** The start of the day after (the API's `to` is exclusive, so "to 20 Nov" includes all of 20 Nov). */
export function nextDayStart(day: string): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return dayStart(next.toISOString().slice(0, 10));
}

/** The page's URL values (all strings, '' = unset). */
export interface PartRequestUrl {
  q: string;
  status: string;
  kind: string;
  machineCategoryId: string;
  reported: string;
  businessId: string;
  from: string;
  to: string;
  page: string;
  pageSize: string;
}

/** The URL's strings as the API query; unknown values are dropped, days become India-time bounds. */
export function queryFromUrl(url: PartRequestUrl): AdminPartRequestQuery {
  const q: AdminPartRequestQuery = { page: Number(url.page) || 1, pageSize: Number(url.pageSize) || 25 };
  if ((PART_REQUEST_STATUSES as readonly string[]).includes(url.status)) q.status = url.status as PartRequestStatus;
  if ((PART_REQUEST_KINDS as readonly string[]).includes(url.kind)) q.kind = url.kind as PartRequestKind;
  if (isUuid(url.machineCategoryId)) q.machineCategoryId = url.machineCategoryId;
  if (url.reported === 'true' || url.reported === 'false') q.reported = url.reported === 'true';
  if (isUuid(url.businessId)) q.businessId = url.businessId;
  if (isDay(url.from)) q.from = dayStart(url.from);
  if (isDay(url.to)) q.to = nextDayStart(url.to);
  if (url.q.trim()) q.q = url.q.trim();
  return q;
}

// ─── formatting and wording ───

/** "#300001": the reference support quotes ("Requirement #300001"). */
export const formatRequestRef = (ref: number) => `#${ref}`;

/** A calendar day (`YYYY-MM-DD`) read at noon UTC, so no timezone moves it to the day before. */
export const dayAtNoon = (day: string) => `${day}T12:00:00Z`;

export const PART_REQUEST_STATUS_LABELS: Record<PartRequestStatus, string> = {
  active: 'Active',
  fulfilled: 'Fulfilled',
  closed: 'Closed',
  expired: 'Expired',
  removed: 'Removed',
};

export const PART_REQUEST_KIND_LABELS: Record<PartRequestKind, string> = { part: 'Part', machine: 'Machine' };

export const REACH_LABELS: Record<PartRequestReach, string> = {
  radius_50: 'Within 50 km',
  radius_200: 'Within 200 km',
  state: 'Its state',
  all_india: 'All India',
};

export const AUDIENCE_LABELS: Record<PartRequestAudience, string> = {
  verified_only: 'GST-verified sellers only',
  any_seller: 'Any seller',
};

export const CLOSE_REASON_LABELS: Record<PartRequestCloseReason, string> = {
  found_elsewhere: 'Found it elsewhere',
  no_longer_needed: 'No longer needed',
  posted_by_mistake: 'Posted by mistake',
  other: 'Other',
};

export const REPLY_STATUS_LABELS: Record<PartRequestReplyStatus, string> = {
  pending: 'Pending (listing not live yet)',
  delivered: 'Delivered',
  withdrawn: 'Withdrawn',
  dropped: 'Dropped',
};

export const DROP_REASON_LABELS: Record<PartRequestDropReason, string> = {
  listing_removed: 'Seller removed the listing',
  listing_removed_by_team: 'Listing removed by the team',
  listing_rejected: 'Listing rejected in moderation',
  request_closed: 'Requirement closed',
  request_expired: 'Requirement expired',
  request_removed: 'Requirement removed by the team',
  blocked: 'Blocked between the businesses',
  not_eligible: 'Seller no longer eligible',
  no_longer_fits: 'Listing no longer fits',
};

export const MATCH_TIER_LABELS: Record<PartRequestMatchTier, string> = {
  part_number: 'Part number',
  name_fit: 'Name and fit',
  name: 'Name',
  machine_fit: 'Machine fit',
};

export const PART_REQUEST_REPORT_REASON_LABELS: Record<PartRequestReportReason, string> = {
  spam: 'Spam',
  fake: 'Fake requirement',
  contact_details: 'Shares contact details',
  prohibited: 'Prohibited item',
  other: 'Other',
};

const ERROR_WORDS: Record<string, string> = {
  PART_REQUEST_NOT_FOUND: 'This requirement no longer exists',
  PART_REQUEST_TRANSITION_NOT_ALLOWED: "This requirement's status changed: that action isn't possible now",
};

/** Codes that mean the page is out of date: reload it. */
const STALE_CODES = ['PART_REQUEST_NOT_FOUND', 'PART_REQUEST_TRANSITION_NOT_ALLOWED'];

/** A failed remove / restore in words, and whether the page should reload. */
export function explainPartRequestError(err: unknown): { message: string; stale: boolean } {
  if (err instanceof ApiError) {
    const code = err.code ?? '';
    return { message: ERROR_WORDS[code] ?? (err.message || 'Something went wrong'), stale: STALE_CODES.includes(code) };
  }
  return { message: err instanceof Error && err.message ? err.message : 'Something went wrong', stale: false };
}
