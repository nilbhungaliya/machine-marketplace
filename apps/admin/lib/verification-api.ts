import type {
  AdminDocumentUrl, AdminGstReviewDetail, AdminGstReviewRow, Constitution, GstApprovalEdits, GstCheckResult,
  GstDocumentType, GstProofStatus, GstReviewQueue,
} from '@mpm/shared-types';
import { api, ApiError } from './api';

// Typed calls to the Business verification API (F1 + A2 spec §8.1). Each returns the endpoint's `data`.

/** `listReviews` returns at most this many rows per tab, with no paging. */
export const REVIEW_LIST_CAP = 200;

/** Reject reasons and ask-for-more messages: 3–500 characters (the service's rule). */
export const DECISION_TEXT_MIN = 3;
export const DECISION_TEXT_MAX = 500;

/** The public GST portal's taxpayer search: the officer's check when no provider decides (§5.3). */
export const GST_PORTAL_SEARCH_URL = 'https://services.gst.gov.in/services/searchtp';

export interface ReviewDecision {
  id: string;
  businessId: string;
  status: 'approved' | 'rejected' | 'needs_more';
}

/** Waiting and Needs more oldest first; Decided (last 90 days) newest first. At most REVIEW_LIST_CAP rows. */
export const fetchReviews = (status: GstReviewQueue) =>
  api.get<AdminGstReviewRow[]>(`/admin/verification/reviews?status=${status}`);

export const fetchReview = (id: string) => api.get<AdminGstReviewDetail>(`/admin/verification/reviews/${id}`);

/**
 * `edits` apply only when no fresh lookup decides (no provider, or the provider down at approval).
 * 409 STALE_REVIEW / GST_NOT_ACTIVE / GSTIN_TAKEN / GST_ALREADY_VERIFIED.
 */
export const approveReview = (id: string, edits: GstApprovalEdits = {}) =>
  api.post<ReviewDecision>(`/admin/verification/reviews/${id}/approve`, edits);

export const rejectReview = (id: string, reason: string) =>
  api.post<ReviewDecision>(`/admin/verification/reviews/${id}/reject`, { reason });

export const askForMore = (id: string, message: string) =>
  api.post<ReviewDecision>(`/admin/verification/reviews/${id}/ask-for-more`, { message });

/** A 300-second link; each one is audit-logged. 503 STORAGE_UNAVAILABLE until R2 is configured. */
export const fetchDocumentUrl = (proofId: string, index: number) =>
  api.get<AdminDocumentUrl>(`/admin/verification/documents/${proofId}/${index}/url`);

/** The nav badge: how many reviews wait (REVIEW_LIST_CAP means "at least"). */
export const fetchWaitingCount = async () => (await fetchReviews('waiting')).length;

// ─── wording ───

export const STALE_REVIEW_MESSAGE = 'Someone already decided this review';
export const STORAGE_UNAVAILABLE_MESSAGE = "Document storage isn't set up yet";

/** The message an officer reads for a failed call; the API's own wording otherwise. */
export function explainVerificationError(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError) {
    if (err.code === 'STALE_REVIEW') return STALE_REVIEW_MESSAGE;
    if (err.code === 'STORAGE_UNAVAILABLE') return STORAGE_UNAVAILABLE_MESSAGE;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

export const DOCUMENT_TYPE_LABELS: Record<GstDocumentType, string> = {
  gst_certificate: 'GST certificate (REG-06)',
  id_proof: 'ID of a named person',
  authorisation_letter: 'Authorisation letter',
};

export const CONSTITUTION_LABELS: Record<Constitution, string> = {
  proprietorship: 'Proprietorship',
  partnership: 'Partnership',
  llp: 'LLP',
  private_limited: 'Private limited company',
  public_limited: 'Public limited company',
  huf: 'Hindu undivided family',
  trust_society: 'Trust or society',
  government: 'Government body',
  other: 'Other',
};

/** A constitution key in words; a provider's free text as it came. */
export function constitutionLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return CONSTITUTION_LABELS[value as Constitution] ?? value;
}

export const PROOF_STATUS_LABELS: Partial<Record<GstProofStatus, string>> = {
  waiting: 'Waiting',
  needs_more: 'Needs more',
  approved: 'Approved',
  rejected: 'Rejected',
  declared: 'Declared',
  code_sent: 'Code sent',
  passed: 'Code passed',
  spent: 'Closed',
};

export const CHECK_RESULT_LABELS: Record<GstCheckResult, string> = {
  found: 'Found',
  held: 'Held by another business',
  status_refused: 'Not active',
  not_found: 'Not found',
  failed: 'Provider unreachable',
};

export const QUEUE_LABELS: Record<GstReviewQueue, string> = {
  waiting: 'Waiting',
  needs_more: 'Needs more',
  decided: 'Decided',
};
