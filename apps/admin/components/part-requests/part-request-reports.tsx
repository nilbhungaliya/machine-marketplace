'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AdminReportRow, PartRequestReportReason } from '@mpm/shared-types';
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
import { REPORT_STATUS_LABELS, isOpenReport } from '@/lib/conversations-api';
import { PART_REQUEST_REPORT_REASON_LABELS } from '@/lib/part-requests-api';
import { formatDateTime } from '@/lib/utils';

const reasonLabel = (reason: string) => PART_REQUEST_REPORT_REASON_LABELS[reason as PartRequestReportReason] ?? reason;

/**
 * Part-request reports as a table (F8 spec §14): the requirement's masked name linking to its admin page (left out on
 * that page itself), the reason and details, reporter, status with the resolution note, and Resolve for an open one
 * (actioned / dismissed with a note, the shared dialog). Removing the requirement closes its open reports itself.
 */
export function PartRequestReportList({ reports, showRequest, onChanged }: {
  reports: AdminReportRow[];
  showRequest: boolean;
  onChanged: () => void;
}) {
  const [resolving, setResolving] = useState<AdminReportRow | null>(null);
  const headers = [...(showRequest ? ['Requirement'] : []), 'Reason', 'Reported by', 'Status', 'Reported', ''];

  return (
    <>
      <div className="overflow-x-auto">
        <table aria-label="Part request reports" className="min-w-full divide-y divide-gray-100 text-sm">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h || <span className="sr-only">Actions</span>}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {reports.map((r) => (
              <tr key={r.id} className="align-top">
                {showRequest && (
                  <td className="px-3 py-2.5">
                    {r.partRequestId ? (
                      <Link href={`/part-requests/${r.partRequestId}/`} className="block max-w-[18rem] truncate font-semibold text-brand-700 hover:underline">
                        {r.partRequestName || 'Requirement'}
                      </Link>
                    ) : <span className="text-gray-500">Requirement no longer exists</span>}
                  </td>
                )}
                <td className="px-3 py-2.5">
                  <span className="block font-semibold text-gray-900">{reasonLabel(r.reason)}</span>
                  {r.details && <span className="mt-0.5 block max-w-[22rem] whitespace-pre-wrap text-[13px] text-gray-600">{r.details}</span>}
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
                  {isOpenReport(r.status) && <Button size="sm" onClick={() => setResolving(r)}>Resolve</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {resolving && (
        <ReportResolveDialog reportId={resolving.id} what="part request" onClose={() => setResolving(null)} onDone={onChanged} />
      )}
    </>
  );
}

/** Reports & flags › Part requests (F8 spec §14): the queue by report status, 30 a page. */
export function PartRequestReportsTable() {
  const [status, setStatus] = useState<ReportStatusTab>('open');
  const { items, error, hasMore, loadingMore, loadMore, reload } = useAdminReports('part_request', status || undefined);

  const body = () => {
    if (error && !items) return <ErrorState message={error} onRetry={() => void reload()} />;
    if (!items) return <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={5} cols={5} /></div>;
    if (items.length === 0) {
      return (
        <div className="rounded-[20px] border border-gray-200 bg-white">
          <EmptyState title={status === 'open' ? 'No open part request reports' : 'No part request reports'} />
        </div>
      );
    }
    return (
      <div className="rounded-[20px] border border-gray-200 bg-white">
        <PartRequestReportList reports={items} showRequest onChanged={() => void reload()} />
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
    </div>
  );
}
