'use client';

import { ChevronLeft, ChevronRight, Flag, ImageOff } from 'lucide-react';
import type { AdminModerationQueue, AdminModerationRow, ModerationTab } from '@mpm/shared-types';
import StatusBadge from '@/components/status-badge';
import { EmptyState, Skeleton } from '@/components/ui/states';
import { ADMIN_ACTION_LABELS, REVIEW_REASON_LABELS, SIDE_LABELS, formatRef } from '@/lib/listings-api';
import { LISTING_STATUS_LABELS } from '@/lib/status';
import { cn, formatDateTime } from '@/lib/utils';
import { age } from '@/components/verification/review-queue';

const EMPTY: Record<ModerationTab, { title: string; description: string }> = {
  review: { title: 'Nothing to review', description: 'Listings that need a look before they go live appear here, oldest first.' },
  reported: { title: 'No open reports', description: 'Listings buyers reported wait here, most reports first.' },
  decided: { title: 'No decisions yet', description: 'Approvals, rejections, hides and removals of the last 90 days.' },
};

const pill = (text: string, key: string, className = 'bg-sun text-sun-ink') => (
  <span key={key} className={cn('inline-flex items-center rounded-full px-2 py-px text-[11px] font-extrabold', className)}>{text}</span>
);

function RowMeta({ tab, row }: { tab: ModerationTab; row: AdminModerationRow }) {
  if (tab === 'decided' && row.decision) {
    return <span title={formatDateTime(row.decision.at)}>{ADMIN_ACTION_LABELS[row.decision.action]}, {age(row.decision.at)}</span>;
  }
  if (tab === 'reported' && row.lastReportAt) {
    return <span title={formatDateTime(row.lastReportAt)}>Last report {age(row.lastReportAt)}</span>;
  }
  return row.statusChangedAt ? <span title={formatDateTime(row.statusChangedAt)}>Waiting {age(row.statusChangedAt)}</span> : null;
}

/** The left column of Listing moderation (F2 spec §11.1): one tab's listings, 50 a page. */
export function ModerationQueue({ tab, queue, selectedId, onSelect, onPage }: {
  tab: ModerationTab;
  /** null while loading. */
  queue: AdminModerationQueue | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPage: (page: number) => void;
}) {
  if (!queue) {
    return (
      <div className="space-y-3 rounded-[20px] border border-gray-200 bg-white p-4" role="status" aria-label="Loading">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}
      </div>
    );
  }
  if (queue.rows.length === 0) {
    return <div className="rounded-[20px] border border-gray-200 bg-white"><EmptyState {...EMPTY[tab]} /></div>;
  }

  const pages = Math.max(1, Math.ceil(queue.total / queue.pageSize));

  return (
    <nav aria-label="Listings" className="overflow-hidden rounded-[20px] border border-gray-200 bg-white lg:sticky lg:top-0">
      <ul className="max-h-[calc(100vh-15rem)] divide-y divide-gray-100 overflow-y-auto">
        {queue.rows.map((row) => {
          const on = row.id === selectedId;
          return (
            <li key={row.id}>
              <button
                type="button"
                aria-current={on ? 'true' : undefined}
                onClick={() => onSelect(row.id)}
                className={cn(
                  'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600',
                  on && 'bg-brand-50 shadow-[inset_3px_0_0_theme(colors.brand.600)] hover:bg-brand-50',
                )}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-photo">
                  {row.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.thumbUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageOff size={14} aria-hidden className="text-gray-400" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-gray-900">{row.title}</span>
                  <span className="block truncate text-xs text-gray-500">
                    {row.business.name}{row.business.gstVerified ? '' : ' · not GST verified'}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    <span className="font-mono">{formatRef(row.ref)}</span> · <RowMeta tab={tab} row={row} />
                  </span>
                  {(row.reviewReasons.length > 0 || row.openReports > 0) && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {tab === 'review' && row.reviewReasons.map((r) => pill(REVIEW_REASON_LABELS[r] ?? r, r))}
                      {row.openReports > 0 && pill(
                        `${row.openReports} ${row.openReports === 1 ? 'report' : 'reports'}`,
                        'reports',
                        'bg-red-50 text-red-600',
                      )}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {tab !== 'review' && <StatusBadge status={row.status} label={LISTING_STATUS_LABELS[row.status]} />}
                  {row.side && row.side !== 'not_applicable' && (
                    <span className="rounded-full bg-gray-100 px-2 py-px text-[11px] font-bold text-gray-700">{SIDE_LABELS[row.side]}</span>
                  )}
                  {row.openReports > 0 && tab !== 'reported' && <Flag size={12} aria-hidden className="text-red-600" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-[13px] text-gray-600">
          <button
            type="button"
            aria-label="Previous page"
            disabled={queue.page <= 1}
            onClick={() => onPage(queue.page - 1)}
            className="rounded-full p-1.5 hover:bg-gray-100 disabled:opacity-40"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="tnum">Page {queue.page} of {pages} · {queue.total} listings</span>
          <button
            type="button"
            aria-label="Next page"
            disabled={queue.page >= pages}
            onClick={() => onPage(queue.page + 1)}
            className="rounded-full p-1.5 hover:bg-gray-100 disabled:opacity-40"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </nav>
  );
}
