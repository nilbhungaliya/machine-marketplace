import type {
  AdminReportRow, AdminThreadRead, ConversationReportReason, QuickEnquiry, ReportStatus, SystemLineCode,
} from '@mpm/shared-types';
import { api, ApiError } from './api';

// Typed calls for conversation reads and the Reports & flags list (F6 + F7 spec §16.1–§16.3).
// Roles: moderator and support (super_admin passes); a read based on a dispute is support / super_admin only.

/**
 * `POST /admin/threads/:id/read` (§16.3): the conversation as stored, photos signed for 300 s, never a revealed contact
 * number. Allowed only while the thread has a conversation report (open, reviewing or resolved within 30 days) or, for
 * support, a dispute (open or resolved within 30 days). Every call writes `audit_log` `thread.read` with the reason.
 * The caller keeps the result in component state only: no cache, no storage.
 */
export const readThread = (threadId: string, reason: string) =>
  api.post<AdminThreadRead>(`/admin/threads/${threadId}/read`, { reason });

export type AdminReportTarget = 'conversation' | 'review';

export interface AdminReportPage {
  items: AdminReportRow[];
  nextCursor: string | null;
}

/** `GET /admin/reports?target=&status=&cursor=`: newest first, 30 a page. */
export function fetchAdminReports(q: { target: AdminReportTarget; status?: ReportStatus; cursor?: string }): Promise<AdminReportPage> {
  const params = new URLSearchParams({ target: q.target });
  if (q.status) params.set('status', q.status);
  if (q.cursor) params.set('cursor', q.cursor);
  return api.get<AdminReportPage>(`/admin/reports?${params.toString()}`);
}

export type ReportOutcome = 'actioned' | 'dismissed';

/** Closes one conversation or review report; the note (3–500) goes to the audit log. `409 REPORT_NOT_OPEN` if closed. */
export const resolveReport = (id: string, outcome: ReportOutcome, note: string) =>
  api.post<AdminReportRow>(`/admin/reports/${id}/resolve`, { outcome, note });

/** An open or reviewing report can still be resolved. */
export const isOpenReport = (status: ReportStatus) => status === 'open' || status === 'reviewing';

// ─── wording ───

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: 'Open',
  reviewing: 'Reviewing',
  actioned: 'Actioned',
  dismissed: 'Dismissed',
};

export const CONVERSATION_REPORT_REASON_LABELS: Record<ConversationReportReason, string> = {
  spam: 'Spam',
  scam_or_advance_payment: 'Scam or advance payment',
  abusive: 'Abusive',
  fake_listing: 'Fake listing',
  other: 'Something else',
};

export const QUICK_ENQUIRY_LABELS: Record<QuickEnquiry, string> = {
  is_available: 'Is it available?',
  more_photos: 'More photos',
  video: 'A video',
  specifications: 'Specifications',
  best_price: 'Best price',
  compatibility: 'Will it fit my machine?',
  price_request: 'Ask price',
};

export const SYSTEM_LINE_LABELS: Record<SystemLineCode, string> = {
  offer_withdrawn: 'Offer withdrawn',
  offer_rejected: 'Offer rejected',
  offer_expired: 'Offer expired',
  offer_backup: 'Offer moved to backup',
  offer_revived: 'Backup offer revived',
  offer_reconfirmed: 'Offer reconfirmed',
  offers_closed: 'Offers closed',
  deal_agreed: 'Deal agreed',
  deal_notes_changed: 'Deal notes changed',
  deal_handed_over: 'Handed over',
  deal_completed: 'Deal completed',
  deal_auto_completed: 'Deal completed automatically',
  deal_cancel_requested: 'Cancel requested',
  deal_cancel_request_withdrawn: 'Cancel request cleared',
  deal_cancelled: 'Deal cancelled',
  deal_problem_reported: 'Problem reported',
  deal_dispute_resolved: 'Dispute resolved by support',
  contact_shared: 'Contact number shared',
  blocked: 'A business blocked the other',
};

const READ_ERROR_WORDS: Record<string, string> = {
  ADMIN_READ_NOT_ALLOWED:
    'This conversation can only be read while it has an open report or dispute, or within 30 days of its resolution.',
  THREAD_NOT_FOUND: 'This conversation no longer exists',
};

export function explainReadError(err: unknown): string {
  if (err instanceof ApiError && err.code && READ_ERROR_WORDS[err.code]) return READ_ERROR_WORDS[err.code];
  return err instanceof Error && err.message ? err.message : 'Could not open the conversation';
}

const REPORT_ERROR_WORDS: Record<string, string> = {
  REPORT_NOT_OPEN: 'This report was already closed',
  REPORT_NOT_FOUND: 'This report no longer exists',
};

export function explainReportError(err: unknown): { message: string; stale: boolean } {
  if (err instanceof ApiError && err.code && REPORT_ERROR_WORDS[err.code]) {
    return { message: REPORT_ERROR_WORDS[err.code], stale: true };
  }
  return { message: err instanceof Error && err.message ? err.message : 'Could not resolve the report', stale: false };
}
