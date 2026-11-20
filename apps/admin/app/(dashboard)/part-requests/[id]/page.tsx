'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { AdminPartRequestDetail } from '@mpm/shared-types';
import { PartRequestDetail } from '@/components/part-requests/part-request-detail';
import { RemoveRestoreButton } from '@/components/part-requests/remove-restore-dialog';
import StatusBadge from '@/components/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { useBackTarget } from '@/lib/back-link';
import { classifyLoadError } from '@/lib/load-error';
import {
  PART_REQUEST_KIND_LABELS, PART_REQUEST_STATUS_LABELS, fetchAdminPartRequest, formatRequestRef,
} from '@/lib/part-requests-api';
import { partRequestStatusTone } from '@/lib/status';

const LOAD_MESSAGES = {
  not_found: 'This requirement does not exist.',
  forbidden: "Your role can't open part requests.",
  failed: 'Check your connection and try again.',
};

/** One part request (F8 spec §14), with Remove / Restore in the header. */
export default function PartRequestPage() {
  const { id } = useParams<{ id: string }>();
  const back = useBackTarget({ href: '/part-requests/', label: 'Part requests' });
  const [detail, setDetail] = useState<AdminPartRequestDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchAdminPartRequest(id);
      if (ticket !== latest.current) return;
      setDetail(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (!detail || detail.id !== id) {
    return error ? (
      <ErrorState title="Couldn't open this requirement" message={LOAD_MESSAGES[classifyLoadError(error)]} onRetry={() => void load()} />
    ) : (
      <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={6} cols={3} /></div>
    );
  }

  const ref = formatRequestRef(detail.ref);

  return (
    <div>
      <PageHeader
        back={back}
        trail={[ref]}
        title={detail.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>Requirement <span className="font-mono">{ref}</span> · {PART_REQUEST_KIND_LABELS[detail.kind]}</span>
            <StatusBadge
              status={detail.status}
              label={PART_REQUEST_STATUS_LABELS[detail.status]}
              tone={partRequestStatusTone(detail.status)}
            />
          </span>
        }
        actions={(
          <RemoveRestoreButton
            request={detail}
            onDone={(next) => {
              // A refusal that means the request changed meanwhile answers null: reload it.
              if (next) setDetail(next);
              else void load();
            }}
          />
        )}
      />
      {error !== null && <StaleWarning thing="requirement" onRetry={() => void load()} />}
      <PartRequestDetail detail={detail} onChanged={() => void load()} />
    </div>
  );
}
