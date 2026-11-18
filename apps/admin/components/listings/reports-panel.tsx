'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  ADMIN_REASON_MAX, type AdminListingDetail, type AdminListingReport, type ReportResolution,
} from '@mpm/shared-types';
import { Segmented } from '@/components/filter-kit';
import StatusBadge from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { inputCls, labelCls } from '@/components/ui/field-classes';
import { FormDialog } from '@/components/ui/form-dialog';
import { ApiError } from '@/lib/api';
import { REPORT_REASON_LABELS, explainListingError, resolveReports } from '@/lib/listings-api';
import { refreshNavBadges } from '@/lib/nav-badges';
import { formatDateTime } from '@/lib/utils';

const OPEN = new Set(['open', 'reviewing']);

function ReportItem({ report }: { report: AdminListingReport }) {
  return (
    <li className="px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-bold text-gray-900">{REPORT_REASON_LABELS[report.reason] ?? report.reason}</span>
        <StatusBadge status={report.status} />
        <span className="ml-auto text-xs text-gray-500 tnum">{formatDateTime(report.createdAt)}</span>
      </div>
      <p className="text-[13px] text-gray-600">By {report.reporter.businessName ?? 'a buyer with no business'}</p>
      {report.details && <p className="mt-1 text-gray-800">{report.details}</p>}
      {report.resolvedAt && (
        <p className="mt-1 text-[13px] text-gray-500">
          Closed {formatDateTime(report.resolvedAt)}{report.resolutionNote ? `: ${report.resolutionNote}` : ''}
        </p>
      )}
    </li>
  );
}

/**
 * Open and closed reports of a listing (F2 spec §11.2, §11.3). Resolve closes every open report as dismissed or
 * actioned, with an optional note (`409 NO_OPEN_REPORTS` when someone got there first). Hide and Remove close them
 * as actioned on their own.
 */
export function ReportsPanel({ detail, canAct, onResult, onConflict }: {
  detail: AdminListingDetail;
  canAct: boolean;
  onResult: (next: AdminListingDetail) => void;
  onConflict: (code: string) => void;
}) {
  const [resolving, setResolving] = useState(false);
  const open = detail.reports.filter((r) => OPEN.has(r.status));
  const closed = detail.reports.filter((r) => !OPEN.has(r.status));

  if (detail.reports.length === 0) return <p className="text-sm text-gray-500">No reports.</p>;

  return (
    <div className="space-y-3">
      {open.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-gray-600">Open ({open.length})</h4>
            {canAct && <Button size="sm" variant="secondary" onClick={() => setResolving(true)}>Resolve reports</Button>}
          </div>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">{open.map((r) => <ReportItem key={r.id} report={r} />)}</ul>
        </div>
      )}
      {closed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-bold text-gray-600">Closed ({closed.length})</summary>
          <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">{closed.map((r) => <ReportItem key={r.id} report={r} />)}</ul>
        </details>
      )}
      {resolving && (
        <ResolveDialog
          count={open.length}
          onClose={() => setResolving(false)}
          onSubmit={async (outcome, note) => {
            try {
              const next = await resolveReports(detail.listing.id, outcome, note);
              toast.success(outcome === 'dismissed' ? 'Reports dismissed' : 'Reports closed as actioned');
              refreshNavBadges();
              onResult(next);
              return true;
            } catch (err) {
              toast.error(explainListingError(err, 'Could not resolve the reports'));
              if (err instanceof ApiError && err.status === 409) {
                onConflict(err.code ?? 'CONFLICT');
                return true;
              }
              return false;
            }
          }}
        />
      )}
    </div>
  );
}

function ResolveDialog({ count, onClose, onSubmit }: {
  count: number;
  onClose: () => void;
  onSubmit: (outcome: ReportResolution, note: string | null) => Promise<boolean>;
}) {
  const [outcome, setOutcome] = useState<ReportResolution>('actioned');
  const [note, setNote] = useState('');
  const tooLong = note.trim().length > ADMIN_REASON_MAX;
  return (
    <FormDialog
      open
      onClose={onClose}
      title="Resolve reports"
      description={`Closes ${count === 1 ? 'the open report' : `all ${count} open reports`} of this listing.`}
      dirty={note !== ''}
      submitLabel="Resolve"
      submitDisabled={tooLong}
      onSubmit={async () => {
        if (await onSubmit(outcome, note.trim() || null)) onClose();
      }}
    >
      <div className="space-y-4">
        <div>
          <p className={labelCls}>Outcome</p>
          <Segmented
            items={[['actioned', 'Actioned'], ['dismissed', 'Dismiss']]}
            value={outcome}
            onChange={(v) => setOutcome(v as ReportResolution)}
          />
          <p className="mt-1 text-[12.5px] text-gray-500">
            {outcome === 'actioned' ? 'The reports were right and the listing was dealt with.' : 'The listing is fine as it is.'}
          </p>
        </div>
        <div>
          <label htmlFor="resolve-note" className={labelCls}>Note <span className="font-normal text-gray-500">(optional)</span></label>
          <textarea id="resolve-note" rows={3} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          {tooLong && <p className="mt-1 text-[12.5px] font-semibold text-red-600">At most {ADMIN_REASON_MAX} characters.</p>}
        </div>
      </div>
    </FormDialog>
  );
}
