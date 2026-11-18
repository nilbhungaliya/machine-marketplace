'use client';

import { FileText, Search } from 'lucide-react';
import type { AdminGstReviewRow, GstReviewQueue } from '@mpm/shared-types';
import StatusBadge from '@/components/status-badge';
import { EmptyState, Skeleton } from '@/components/ui/states';
import { PROOF_STATUS_LABELS, REVIEW_LIST_CAP } from '@/lib/verification-api';
import { cn, formatDateTime } from '@/lib/utils';

const EMPTY: Record<GstReviewQueue, { title: string; description: string }> = {
  waiting: { title: 'Nothing waiting', description: 'GST reviews businesses send appear here, oldest first.' },
  needs_more: { title: 'Nobody owes you files', description: 'Reviews you asked more of wait here until the business adds files.' },
  decided: { title: 'No decisions yet', description: 'Approved and rejected reviews of the last 90 days.' },
};

/** "2 h ago", "3 d ago": how long a review has waited, as the queue reads it. */
export function age(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** The left column of Business verification: one tab's reviews (F1 + A2 spec §8.1). */
export function ReviewQueue({ queue, rows, selectedId, onSelect }: {
  queue: GstReviewQueue;
  /** null while loading. */
  rows: AdminGstReviewRow[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!rows) {
    return (
      <div className="space-y-3 rounded-[10px] border border-gray-200 bg-white p-4" role="status" aria-label="Loading">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="rounded-[10px] border border-gray-200 bg-white"><EmptyState {...EMPTY[queue]} /></div>;
  }

  return (
    <nav aria-label="Reviews" className="overflow-hidden rounded-[10px] border border-gray-200 bg-white lg:sticky lg:top-0">
      {rows.length >= REVIEW_LIST_CAP && (
        <p className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-600">
          Showing the {queue === 'decided' ? 'latest' : 'oldest'} {REVIEW_LIST_CAP}
        </p>
      )}
      <ul className="max-h-[calc(100vh-15rem)] divide-y divide-gray-100 overflow-y-auto">
        {rows.map((row) => {
          const on = row.id === selectedId;
          const when = queue === 'decided' && row.decidedAt ? row.decidedAt : queue === 'needs_more' ? row.updatedAt : row.createdAt;
          return (
            <li key={row.id}>
              <button
                type="button"
                aria-current={on ? 'true' : undefined}
                onClick={() => onSelect(row.id)}
                className={cn(
                  'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400',
                  on && 'bg-brand-50 shadow-[inset_3px_0_0_theme(colors.brand.600)] hover:bg-brand-50',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-gray-900">{row.businessName}</span>
                  <span className="block truncate text-xs text-gray-500" title={formatDateTime(when)}>
                    {row.city ?? 'No city'}, {age(when)}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                    <span className="font-mono">{row.gstin}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {queue === 'decided' && <StatusBadge status={row.status} label={PROOF_STATUS_LABELS[row.status]} />}
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500" title={row.hasLookup ? 'Lookup attached' : 'Details typed by the business'}>
                    {row.hasLookup ? <Search size={12} aria-hidden /> : null}
                    <FileText size={12} aria-hidden /> {row.documentCount}
                    <span className="sr-only">{row.hasLookup ? ', lookup attached' : ', no lookup'}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
