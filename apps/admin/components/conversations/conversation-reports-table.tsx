'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AdminReportRow, AdminThreadRead, ConversationReportReason, ReportStatus } from '@mpm/shared-types';
import StatusBadge from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { StaleWarning } from '@/components/ui/stale-warning';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import {
  CONVERSATION_REPORT_REASON_LABELS, REPORT_STATUS_LABELS, isOpenReport,
} from '@/lib/conversations-api';
import { formatDateTime } from '@/lib/utils';
import { ConversationView } from './conversation-view';
import { ReadReasonDialog } from './read-reason-dialog';
import { ReportResolveDialog } from './report-resolve-dialog';
import { useAdminReports } from './use-admin-reports';

export type ReportStatusTab = '' | ReportStatus;

export const REPORT_STATUS_TABS: Array<{ value: ReportStatusTab; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'actioned', label: 'Actioned' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: '', label: 'All' },
];

const reasonLabel = (reason: string) => CONVERSATION_REPORT_REASON_LABELS[reason as ConversationReportReason] ?? reason;

const businessLink = (businessId: string, name: string) => (
  <Link href={`/businesses/${businessId}/`} className="font-semibold text-brand-700 hover:underline">{name}</Link>
);

/**
 * Reported conversations (F6 + F7 spec §16.1), shared by Conversations and Reports & flags: reason, reporter, the two
 * parties (linked to their business pages, where Suspend / Block live), status. Read conversation asks for a reason
 * (§16.3) and shows the messages below, held in this component's state only; Resolve closes the report.
 */
export function ConversationReportsTable() {
  const [status, setStatus] = useState<ReportStatusTab>('open');
  const { items, error, hasMore, loadingMore, loadMore, reload } = useAdminReports('conversation', status || undefined);
  const [reading, setReading] = useState<AdminReportRow | null>(null);
  const [read, setRead] = useState<{ report: AdminReportRow; data: AdminThreadRead } | null>(null);
  const [resolving, setResolving] = useState<AdminReportRow | null>(null);

  const body = () => {
    if (error && !items) return <ErrorState message={error} onRetry={() => void reload()} />;
    if (!items) return <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={5} cols={5} /></div>;
    if (items.length === 0) {
      return (
        <div className="rounded-[20px] border border-gray-200 bg-white">
          <EmptyState title={status === 'open' ? 'No open conversation reports' : 'No conversation reports'} />
        </div>
      );
    }
    return (
      <div className="overflow-x-auto rounded-[20px] border border-gray-200 bg-white">
        <table aria-label="Conversation reports" className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50/80">
            <tr>
              {['Reason', 'Reported by', 'Conversation between', 'Status', 'Reported', ''].map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h || <span className="sr-only">Actions</span>}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2.5">
                  <span className="block font-semibold text-gray-900">{reasonLabel(r.reason)}</span>
                  {r.details && <span className="mt-0.5 block max-w-[22rem] whitespace-pre-wrap text-[13px] text-gray-600">{r.details}</span>}
                </td>
                <td className="px-3 py-2.5">{businessLink(r.reporter.businessId, r.reporter.name)}</td>
                <td className="px-3 py-2.5">
                  {r.parties ? (
                    <span className="block space-y-0.5">
                      <span className="block">{businessLink(r.parties.buyer.businessId, r.parties.buyer.name)} <span className="text-gray-500">buyer</span></span>
                      <span className="block">{businessLink(r.parties.seller.businessId, r.parties.seller.name)} <span className="text-gray-500">seller</span></span>
                    </span>
                  ) : '—'}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={r.status} label={REPORT_STATUS_LABELS[r.status]} />
                  {r.resolutionNote && <span className="mt-1 block max-w-[16rem] text-[12.5px] text-gray-600">{r.resolutionNote}</span>}
                </td>
                <td className="px-3 py-2.5 tnum">{formatDateTime(r.createdAt)}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className="inline-flex gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => setReading(r)}>Read conversation</Button>
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
    <div className="space-y-4">
      <div>
        <Tabs items={REPORT_STATUS_TABS} value={status} onChange={(v) => { setStatus(v); setRead(null); }} />
        {error && items && <StaleWarning thing="list" onRetry={() => void reload()} />}
        {body()}
      </div>

      {read && (
        <ConversationView
          read={read.data}
          basis={`a conversation report (${reasonLabel(read.report.reason)})`}
          onClose={() => setRead(null)}
        />
      )}

      {reading && (
        <ReadReasonDialog
          threadId={reading.targetId}
          basis={{ kind: 'report', label: `Conversation report: ${reasonLabel(reading.reason)}` }}
          onClose={() => setReading(null)}
          onRead={(data) => setRead({ report: reading, data })}
        />
      )}
      {resolving && (
        <ReportResolveDialog
          reportId={resolving.id}
          what="conversation"
          onClose={() => setResolving(null)}
          onDone={() => void reload()}
        />
      )}
    </div>
  );
}
