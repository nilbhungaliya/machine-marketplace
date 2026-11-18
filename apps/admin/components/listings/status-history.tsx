import type { ListingHistoryEntry } from '@mpm/shared-types';
import StatusBadge from '@/components/status-badge';
import { ACTOR_LABELS, historyActionLabel } from '@/lib/listings-api';
import { LISTING_STATUS_LABELS } from '@/lib/status';
import { formatDateTime } from '@/lib/utils';

/** Every status change of a listing, newest first (F2 spec §7.5, §11.2). */
export function StatusHistory({ history }: { history: ListingHistoryEntry[] }) {
  if (history.length === 0) return <p className="text-sm text-gray-500">No status changes yet.</p>;
  const rows = [...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <ol className="divide-y divide-gray-100 rounded-xl border border-gray-200">
      {rows.map((h) => (
        <li key={h.id} className="px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-gray-900">{historyActionLabel(h.action)}</span>
            {h.fromStatus && <StatusBadge status={h.fromStatus} label={LISTING_STATUS_LABELS[h.fromStatus]} />}
            {h.fromStatus && <span aria-hidden className="text-gray-400">→</span>}
            <StatusBadge status={h.toStatus} label={LISTING_STATUS_LABELS[h.toStatus]} />
            <span className="text-gray-500">
              by {h.actor === 'admin' ? (h.adminName ?? 'a deleted admin') : ACTOR_LABELS[h.actor].toLowerCase()}
            </span>
            <span className="ml-auto text-xs text-gray-500 tnum">{formatDateTime(h.createdAt)}</span>
          </div>
          {h.reason && <p className="mt-0.5 text-gray-700">{h.reason}</p>}
        </li>
      ))}
    </ol>
  );
}
