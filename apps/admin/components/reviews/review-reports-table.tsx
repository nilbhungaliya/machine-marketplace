'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AdminReportRow, ReviewFacet, ReviewReportReason } from '@mpm/shared-types';
import {
  REPORT_STATUS_TABS, type ReportStatusTab,
} from '@/components/conversations/conversation-reports-table';
import { ReportResolveDialog } from '@/components/conversations/report-resolve-dialog';
import { useAdminReports } from '@/components/conversations/use-admin-reports';
import StatusBadge from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { StaleWarning } from '@/components/ui/stale-warning';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth-context';
import { REPORT_STATUS_LABELS, isOpenReport } from '@/lib/conversations-api';
import { REVIEW_FACET_LABELS, REVIEW_REPORT_REASON_LABELS } from '@/lib/reviews-admin-api';
import { formatDateTime } from '@/lib/utils';
import { ReviewHideDialog, type ModeratedReview } from './review-hide-dialog';

const reasonLabel = (reason: string) => REVIEW_REPORT_REASON_LABELS[reason as ReviewReportReason] ?? reason;

function ReviewCell({ review }: { review: NonNullable<AdminReportRow['review']> }) {
  const ratings = Object.entries(review.ratings) as Array<[ReviewFacet, number]>;
  return (
    <span className="block max-w-[26rem] space-y-1">
      <span className="block text-[13px] text-gray-600">
        <Link href={`/businesses/${review.reviewer.businessId}/`} className="font-semibold text-brand-700 hover:underline">{review.reviewer.name}</Link>
        {' about '}
        <Link href={`/businesses/${review.reviewed.businessId}/`} className="font-semibold text-brand-700 hover:underline">{review.reviewed.name}</Link>
      </span>
      {ratings.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {ratings.map(([facet, stars]) => (
            <span key={facet} className="rounded-full bg-gray-100 px-2 py-px text-[12px] font-semibold text-gray-700">
              {REVIEW_FACET_LABELS[facet] ?? facet} <span className="tnum">{stars}/5</span>
            </span>
          ))}
        </span>
      )}
      {review.text && <span className="block whitespace-pre-wrap text-gray-900">{review.text}</span>}
      {review.replyText && (
        <span className="block border-l-2 border-gray-200 pl-2 text-[13px] text-gray-700">
          <span className="font-semibold">Reply:</span> {review.replyText}
          {review.replyHidden && <span className="ml-1.5 rounded-full bg-gray-100 px-2 py-px text-[11px] font-bold text-gray-600">Hidden</span>}
        </span>
      )}
      {review.hidden && <span className="inline-block rounded-full bg-red-50 px-2 py-px text-[11px] font-bold text-red-600">Review hidden</span>}
    </span>
  );
}

/**
 * Reported reviews (F6 + F7 spec §10.6, §16.1): the review as stored (stars, text, reply) with the report's reason and
 * reporter. Moderators hide the review or only its reply, or unhide it (reason required, audit-logged), then resolve
 * the report (actioned / dismissed); support sees the list and resolves only.
 */
export function ReviewReportsTable() {
  const { hasRole } = useAuth();
  const canModerate = hasRole('moderator');
  const [status, setStatus] = useState<ReportStatusTab>('open');
  const { items, error, hasMore, loadingMore, loadMore, reload } = useAdminReports('review', status || undefined);
  const [moderating, setModerating] = useState<ModeratedReview | null>(null);
  const [resolving, setResolving] = useState<AdminReportRow | null>(null);

  const body = () => {
    if (error && !items) return <ErrorState message={error} onRetry={() => void reload()} />;
    if (!items) return <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={5} cols={4} /></div>;
    if (items.length === 0) {
      return (
        <div className="rounded-[20px] border border-gray-200 bg-white">
          <EmptyState title={status === 'open' ? 'No open review reports' : 'No review reports'} />
        </div>
      );
    }
    return (
      <div className="overflow-x-auto rounded-[20px] border border-gray-200 bg-white">
        <table aria-label="Review reports" className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50/80">
            <tr>
              {['Review', 'Reason', 'Reported by', 'Status', 'Reported', ''].map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h || <span className="sr-only">Actions</span>}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2.5">{r.review ? <ReviewCell review={r.review} /> : <span className="text-gray-500">Review no longer exists</span>}</td>
                <td className="px-3 py-2.5">
                  <span className="block font-semibold text-gray-900">{reasonLabel(r.reason)}</span>
                  {r.details && <span className="mt-0.5 block max-w-[16rem] whitespace-pre-wrap text-[13px] text-gray-600">{r.details}</span>}
                </td>
                <td className="px-3 py-2.5">
                  <Link href={`/businesses/${r.reporter.businessId}/`} className="font-semibold text-brand-700 hover:underline">{r.reporter.name}</Link>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={r.status} label={REPORT_STATUS_LABELS[r.status]} />
                  {r.resolutionNote && <span className="mt-1 block max-w-[14rem] text-[12.5px] text-gray-600">{r.resolutionNote}</span>}
                </td>
                <td className="px-3 py-2.5 tnum">{formatDateTime(r.createdAt)}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className="inline-flex flex-wrap justify-end gap-1.5">
                    {canModerate && r.review && (
                      <Button
                        size="sm"
                        variant={r.review.hidden ? 'secondary' : 'danger'}
                        onClick={() => setModerating({ id: r.review!.id, hidden: r.review!.hidden, replyText: r.review!.replyText, replyHidden: r.review!.replyHidden })}
                      >
                        {r.review.hidden ? 'Unhide' : 'Hide…'}
                      </Button>
                    )}
                    {isOpenReport(r.status) && <Button size="sm" onClick={() => setResolving(r)}>Resolve</Button>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore && (
          <div className="border-t border-gray-100 p-3 text-center">
            <Button size="sm" variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>Load more</Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <Tabs items={REPORT_STATUS_TABS} value={status} onChange={setStatus} />
      {error && items && <StaleWarning thing="list" onRetry={() => void reload()} />}
      {body()}
      {moderating && <ReviewHideDialog review={moderating} onClose={() => setModerating(null)} onDone={() => void reload()} />}
      {resolving && (
        <ReportResolveDialog reportId={resolving.id} target="review" onClose={() => setResolving(null)} onDone={() => void reload()} />
      )}
    </div>
  );
}
