'use client';

import type { ReactNode } from 'react';
import type { AdminGstHistory } from '@mpm/shared-types';
import StatusBadge from '@/components/status-badge';
import { CHECK_RESULT_LABELS, DOCUMENT_TYPE_LABELS, LOOKUP_AT_APPROVAL_LABELS, PROOF_STATUS_LABELS } from '@/lib/verification-api';
import { formatDateTime } from '@/lib/utils';

const PROOF_METHOD: Record<string, string> = { provider_otp: 'Registered-contact code', documents: 'Documents for review' };
const GRANT_METHOD: Record<string, string> = { provider_otp: 'Instant (code)', officer_review: 'Officer review' };

function Block({ title, empty, headers, rows }: { title: string; empty: string; headers: string[]; rows: ReactNode[][] }) {
  return (
    <section aria-label={title}>
      <h4 className="mb-1.5 text-[13px] font-bold text-gray-700">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50/80">
              <tr>{headers.map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((cells, i) => (
                <tr key={i}>{cells.map((c, j) => <td key={j} className="px-3 py-2 align-top text-gray-700">{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const when = (iso: string) => <span className="whitespace-nowrap tnum">{formatDateTime(iso)}</span>;
const gstin = (value: string) => <span className="font-mono text-xs">{value}</span>;

/** A business's GST lookups, proofs (codes and reviews) and grants / revocations, newest first as the API sends them. */
export function GstHistory({ history }: { history: AdminGstHistory }) {
  return (
    <div className="space-y-4">
      <Block
        title="Decisions"
        empty="Never verified."
        headers={['Verified', 'How', 'Status', 'Revoked', 'Reason']}
        rows={history.verifications.map((v) => [
          when(v.verifiedAt),
          v.method ? GRANT_METHOD[v.method] ?? v.method : '—',
          <StatusBadge key="s" status={v.status} tone={v.status === 'active' ? 'green' : 'red'} />,
          v.revokedAt ? when(v.revokedAt) : '—',
          v.revokeReason ?? '—',
        ])}
      />
      <Block
        title="Submissions"
        empty="Nothing submitted."
        headers={['Submitted', 'GSTIN', 'Path', 'Status', 'Note']}
        rows={history.proofs.map((p) => [
          when(p.createdAt),
          gstin(p.gstin),
          <span key="m">
            {p.method ? PROOF_METHOD[p.method] ?? p.method : '—'}
            {p.documentTypes.length > 0 && (
              <span className="block text-xs text-gray-500">{p.documentTypes.map((t) => DOCUMENT_TYPE_LABELS[t]).join(', ')}</span>
            )}
          </span>,
          <StatusBadge key="s" status={p.status} label={PROOF_STATUS_LABELS[p.status]} />,
          <span key="n" className="whitespace-normal">
            {p.reason ?? p.officerMessage ?? '—'}
            {p.lookupAtApproval && <span className="block text-xs text-gray-500">{LOOKUP_AT_APPROVAL_LABELS[p.lookupAtApproval]}</span>}
          </span>,
        ])}
      />
      <Block
        title="Lookups"
        empty="No lookups."
        headers={['When', 'GSTIN', 'By', 'Result']}
        rows={history.checks.map((c) => [
          when(c.createdAt),
          gstin(c.gstin),
          c.source === 'officer' ? 'Officer' : 'Business',
          <span key="r">{CHECK_RESULT_LABELS[c.result]}{c.gstStatus && c.result !== 'found' ? ` (${c.gstStatus})` : ''}</span>,
        ])}
      />
    </div>
  );
}
