'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminGstReviewDetail, GstApprovalEdits } from '@mpm/shared-types';
import StatusBadge from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { ApiError } from '@/lib/api';
import { backLinkQuery } from '@/lib/back-link';
import { classifyLoadError } from '@/lib/load-error';
import { refreshNavBadges } from '@/lib/nav-badges';
import { cn, formatDate, formatDateTime, formatPhone } from '@/lib/utils';
import {
  GST_PORTAL_SEARCH_URL, LOOKUP_AT_APPROVAL_LABELS, PROOF_STATUS_LABELS, approveReview, askForMore, constitutionLabel,
  explainVerificationError, fetchReview, rejectReview,
} from '@/lib/verification-api';
import { ApproveDialog } from './approve-dialog';
import { DecisionDialog, type TextDecision } from './decision-dialog';
import { DocumentViewer } from './document-viewer';
import { GstHistory } from './gst-history';

const LOAD_MESSAGES = {
  not_found: 'This review does not exist.',
  forbidden: "Your role can't open GST reviews.",
  failed: 'Check your connection and try again.',
};


/** One row of the comparison: the field, the business's side, the GST side; tinted when the API flags a mismatch. */
function CompareRow({ field, business, gst, mismatch = false }: { field: string; business: ReactNode; gst: ReactNode; mismatch?: boolean }) {
  return (
    <tr data-mismatch={mismatch ? 'true' : undefined} className={cn(mismatch && 'bg-amber-50')}>
      <th scope="row" className="w-32 px-3 py-2.5 text-left align-top text-[13px] font-semibold text-gray-500">
        {field}
      </th>
      <td className="px-3 py-2.5 align-top text-sm text-gray-900">{business}</td>
      <td className="px-3 py-2.5 align-top text-sm text-gray-900">
        {gst}
        {mismatch && (
          <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-800">
            <AlertTriangle size={12} aria-hidden /> Doesn&apos;t match
          </span>
        )}
      </td>
    </tr>
  );
}

const dash = <span className="text-gray-400">—</span>;
const joined = (parts: Array<string | null | undefined>) => parts.filter(Boolean).join(', ') || null;

/**
 * One GST review (F1 + A2 spec §8.1): what the business has on its profile beside the attached lookup (or what it
 * typed, with no lookup), mismatches highlighted; the documents; the GST portal search; history; and, while the
 * review waits, Approve / Reject / Ask for more. A review sent back for more files (`needs_more`) can still be
 * rejected, so one the business never answers can be closed (spec §5.3 amendment). A second decision on the same
 * review gets 409 STALE_REVIEW.
 */
export function ReviewDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [review, setReview] = useState<AdminGstReviewDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<'approve' | TextDecision | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchReview(id);
      if (ticket !== latest.current) return;
      setReview(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err);
    }
  }, [id]);

  useEffect(() => {
    setRefusal(null);
    void load();
  }, [load]);

  /** Runs a decision; resolves true when its dialog should close. */
  const decide = async (work: () => Promise<unknown>, success: string): Promise<boolean> => {
    setRefusal(null);
    try {
      await work();
      toast.success(success);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409) {
        // A validation or network error: keep the dialog and what was typed.
        toast.error(explainVerificationError(err, 'Could not save the decision'));
        return false;
      }
      const message = explainVerificationError(err);
      toast.error(message);
      // GST_NOT_ACTIVE, GSTIN_TAKEN, GST_ALREADY_VERIFIED: the review still waits; say why beside it.
      if (err.code !== 'STALE_REVIEW') setRefusal(message);
    }
    refreshNavBadges();
    onChanged();
    await load();
    return true;
  };

  const shown = review?.id === id ? review : null;
  if (!shown) {
    return error ? (
      <ErrorState title="Couldn't open this review" message={LOAD_MESSAGES[classifyLoadError(error)]} onRetry={() => void load()} />
    ) : (
      <div className="space-y-3 rounded-[10px] border border-gray-200 bg-white p-4" role="status" aria-label="Loading">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const r = shown;
  const b = r.business;
  const gst = r.lookup?.details ?? r.entered;
  const waiting = r.status === 'waiting';
  const copyGstin = async () => {
    try {
      await navigator.clipboard.writeText(r.gstin);
      toast.success('GSTIN copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <div className="space-y-4">
      {error !== null && <StaleWarning thing="review" onRetry={() => void load()} />}

      <div className="rounded-[10px] border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900">{b.tradeName}</h2>
              <StatusBadge status={r.status} label={PROOF_STATUS_LABELS[r.status]} />
            </div>
            <p className="mt-1 text-sm text-gray-600">
              GSTIN <span className="font-mono">{r.gstin}</span>
              {' · '}Submitted <span className="tnum">{formatDateTime(r.createdAt)}</span> by {r.submittedBy.name ?? 'an unnamed user'},{' '}
              <span className="tnum">{formatPhone(r.submittedBy.phone)}</span>
            </p>
            <Link
              href={`/businesses/${b.id}/?${backLinkQuery('/verification/', 'Business verification')}`}
              className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline"
            >
              Open business
            </Link>
          </div>
          {(waiting || r.status === 'needs_more') && (
            <div className="flex flex-wrap gap-2">
              {waiting && <Button variant="secondary" onClick={() => setDialog('ask_for_more')}>Ask for more</Button>}
              <Button variant="danger" onClick={() => setDialog('reject')}>Reject</Button>
              {waiting && <Button onClick={() => setDialog('approve')}>Approve</Button>}
            </div>
          )}
        </div>

        {refusal && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{refusal}</p>
        )}
        {b.gstin && b.gstin !== r.gstin && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            The business holds another GSTIN, <span className="font-mono">{b.gstin}</span>. Approving replaces it.
          </p>
        )}
        {r.status === 'needs_more' && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Waiting for the business to add files. You asked: {r.officerMessage}
          </p>
        )}
        {r.status === 'rejected' && r.reason && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
            Rejected{r.decidedAt ? ` on ${formatDate(r.decidedAt)}` : ''}: <span>{r.reason}</span>
          </p>
        )}
        {r.status === 'approved' && (
          <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">
            Approved{r.decidedAt ? ` on ${formatDate(r.decidedAt)}` : ''}.
            {r.lookupAtApproval && ` ${LOOKUP_AT_APPROVAL_LABELS[r.lookupAtApproval]}.`}
            {r.approvedDetails && (
              <span className="block">
                Saved as {r.approvedDetails.legalName}
                {r.approvedDetails.tradeName ? ` (${r.approvedDetails.tradeName})` : ''}, {constitutionLabel(r.approvedDetails.constitution)}.
              </span>
            )}
          </div>
        )}
      </div>

      <Panel
        as="h3"
        title="Details"
        action={
          <span className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void copyGstin()}><Copy size={13} aria-hidden /> Copy GSTIN</Button>
            <a
              href={GST_PORTAL_SEARCH_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
            >
              Search on the GST portal <ExternalLink size={13} aria-hidden />
            </a>
          </span>
        }
      >
        {!r.providerAvailable && (
          <p className="mb-3 text-[13px] text-gray-600">
            No GST provider is connected: check the GSTIN on the GST portal before approving.
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table aria-label="Business and GST details" className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500"><span className="sr-only">Field</span></th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">From the business</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">
                  {r.lookup ? 'From the GST lookup' : 'Typed for the review'}
                  {r.lookup?.resolvedAt && <span className="ml-1 font-normal tnum">· {formatDateTime(r.lookup.resolvedAt)}</span>}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <CompareRow
                field="Name"
                mismatch={r.mismatches.legalName}
                business={b.tradeName}
                gst={gst ? (
                  <>
                    <span className="block">{gst.legalName}</span>
                    {gst.tradeName && <span className="block text-[13px] text-gray-500">Trade name: {gst.tradeName}</span>}
                  </>
                ) : dash}
              />
              <CompareRow field="GSTIN" business={b.gstin ? <span className="font-mono text-[13px]">{b.gstin}</span> : 'None held'} gst={<span className="font-mono text-[13px]">{r.gstin}</span>} />
              <CompareRow field="Address" business={joined([b.addressLine, b.city, b.state]) ?? dash} gst={gst ? joined([gst.address.line, gst.address.city, gst.address.state]) : dash} />
              <CompareRow field="Pincode" mismatch={r.mismatches.pincode} business={b.pincode ? <span className="tnum">{b.pincode}</span> : dash} gst={gst ? <span className="tnum">{gst.address.pincode}</span> : dash} />
              <CompareRow field="Constitution" business={dash} gst={gst ? constitutionLabel(gst.constitution) : dash} />
              {r.lookup && (
                <CompareRow
                  field="GST status"
                  business={dash}
                  gst={
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <StatusBadge status={r.lookup.details.status} />
                      {r.lookup.details.registeredOn && <span className="text-[13px] text-gray-500">Registered {formatDate(r.lookup.details.registeredOn)}</span>}
                    </span>
                  }
                />
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel as="h3" title="Documents">
        <DocumentViewer proofId={r.id} documents={r.documents} storageAvailable={r.storageAvailable} />
      </Panel>

      <Panel as="h3" title="History">
        <GstHistory history={r.history} />
      </Panel>

      {dialog === 'approve' && (
        <ApproveDialog
          review={r}
          onClose={() => setDialog(null)}
          onApprove={(edits: GstApprovalEdits) => decide(() => approveReview(r.id, edits), 'GST verified')}
        />
      )}
      {(dialog === 'reject' || dialog === 'ask_for_more') && (
        <DecisionDialog
          kind={dialog}
          businessName={b.tradeName}
          onClose={() => setDialog(null)}
          onSubmit={(text) => dialog === 'reject'
            ? decide(() => rejectReview(r.id, text), 'Review rejected')
            : decide(() => askForMore(r.id, text), 'Asked the business for more')}
        />
      )}
    </div>
  );
}
