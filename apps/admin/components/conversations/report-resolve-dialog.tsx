'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { explainReportError, resolveReport, type ReportOutcome } from '@/lib/conversations-api';

const optionCls =
  'flex cursor-pointer items-start gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50';

/**
 * Close a conversation or review report (F6 + F7 spec §16.2): actioned (something was done: a review hidden, an account
 * suspended) or dismissed, with a note (3–500) for the audit log. Mount it only while open.
 */
export function ReportResolveDialog({ reportId, what, onClose, onDone }: {
  reportId: string;
  /** "conversation" or "review", for the wording. */
  what: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<ReportOutcome | null>(null);

  return (
    <ReasonDialog
      title={`Resolve this ${what} report`}
      description="Hiding a review or suspending an account is done first, on its own; this closes the report."
      label="Note"
      hint="For the audit log. 3 to 500 characters."
      submitLabel={outcome === 'dismissed' ? 'Dismiss report' : 'Close as actioned'}
      submitBlocked={outcome === null}
      onClose={onClose}
      onSubmit={async (note) => {
        if (!outcome) return false;
        try {
          await resolveReport(reportId, outcome, note);
          toast.success(outcome === 'dismissed' ? 'Report dismissed' : 'Report closed as actioned');
        } catch (err) {
          const { message, stale } = explainReportError(err);
          toast.error(message);
          if (!stale) return false;
        }
        onDone();
        return true;
      }}
    >
      <fieldset>
        <legend className="mb-1.5 text-[13.5px] font-semibold text-gray-900">Outcome</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={optionCls}>
            <input type="radio" name="report-outcome" className="mt-1" checked={outcome === 'actioned'} onChange={() => setOutcome('actioned')} />
            <span>
              <span className="block font-bold text-gray-900">Actioned</span>
              <span className="block text-[13px] text-gray-600">The report was right and something was done.</span>
            </span>
          </label>
          <label className={optionCls}>
            <input type="radio" name="report-outcome" className="mt-1" checked={outcome === 'dismissed'} onChange={() => setOutcome('dismissed')} />
            <span>
              <span className="block font-bold text-gray-900">Dismissed</span>
              <span className="block text-[13px] text-gray-600">Nothing to act on.</span>
            </span>
          </label>
        </div>
      </fieldset>
    </ReasonDialog>
  );
}
