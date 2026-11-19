import type { ReviewFacet, ReviewReportReason } from '@mpm/shared-types';
import { api, ApiError } from './api';

// Typed calls to review moderation (F6 + F7 spec §10.6, §16.2). Role: moderator (super_admin passes). Each takes a
// reason (3–500) that goes to the audit log (`review.hide`, `review.unhide`, `review.hide_reply`).

export type ReviewModerationAction = 'hide' | 'unhide' | 'hide_reply';

const PATHS: Record<ReviewModerationAction, string> = { hide: 'hide', unhide: 'unhide', hide_reply: 'hide-reply' };

export const moderateReview = (reviewId: string, action: ReviewModerationAction, reason: string) =>
  api.post<unknown>(`/admin/reviews/${reviewId}/${PATHS[action]}`, { reason });

export const REVIEW_REPORT_REASON_LABELS: Record<ReviewReportReason, string> = {
  abusive: 'Abusive',
  false: 'False',
  personal_information: 'Personal information',
  other: 'Something else',
};

export const REVIEW_FACET_LABELS: Record<ReviewFacet, string> = {
  matched_listing: 'Matched the listing',
  communication: 'Communication',
  on_time: 'On time',
  payment: 'Payment',
  pickup: 'Pickup',
};

const ERROR_WORDS: Record<string, string> = {
  REVIEW_ALREADY_HIDDEN: 'This review is already hidden',
  REVIEW_NOT_HIDDEN: 'This review is not hidden',
  REPLY_NOT_FOUND: 'This review has no reply to hide',
  REVIEW_NOT_FOUND: 'This review no longer exists',
};

export function explainReviewError(err: unknown): { message: string; stale: boolean } {
  if (err instanceof ApiError && err.code && ERROR_WORDS[err.code]) return { message: ERROR_WORDS[err.code], stale: true };
  return { message: err instanceof Error && err.message ? err.message : 'Could not save', stale: false };
}
