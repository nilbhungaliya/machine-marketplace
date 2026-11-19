'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { AdminDisputeDetail } from '@mpm/shared-types';
import { DisputeDetail } from '@/components/disputes/dispute-detail';
import StatusBadge from '@/components/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { useBackTarget } from '@/lib/back-link';
import { formatDealRef } from '@/lib/deals-api';
import { DISPUTE_CATEGORY_LABELS, DISPUTE_STATUS_LABELS, DISPUTE_STATUS_TONES, fetchDispute } from '@/lib/disputes-api';
import { classifyLoadError } from '@/lib/load-error';
import { refreshNavBadges } from '@/lib/nav-badges';

const LOAD_MESSAGES = {
  not_found: 'This dispute does not exist.',
  forbidden: 'Disputes are for support.',
  failed: 'Check your connection and try again.',
};

/** One dispute (F6 + F7 spec §9.6, §16.1). */
export default function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const back = useBackTarget({ href: '/disputes/', label: 'Disputes' });
  const [dispute, setDispute] = useState<AdminDisputeDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchDispute(id);
      if (ticket !== latest.current) return;
      setDispute(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (!dispute || dispute.id !== id) {
    return error ? (
      <ErrorState title="Couldn't open this dispute" message={LOAD_MESSAGES[classifyLoadError(error)]} onRetry={() => void load()} />
    ) : (
      <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={6} cols={3} /></div>
    );
  }

  return (
    <div>
      <PageHeader
        back={back}
        trail={[formatDealRef(dispute.dealRef)]}
        title={<span>{DISPUTE_CATEGORY_LABELS[dispute.category]} · deal <span className="font-mono">{formatDealRef(dispute.dealRef)}</span></span>}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{dispute.buyer.name} (buyer) and {dispute.seller.name} (seller)</span>
            <StatusBadge status={dispute.status} label={DISPUTE_STATUS_LABELS[dispute.status]} tone={DISPUTE_STATUS_TONES[dispute.status]} />
          </span>
        }
      />
      {error !== null && <StaleWarning thing="dispute" onRetry={() => void load()} />}
      <DisputeDetail
        dispute={dispute}
        onChanged={async () => {
          await load();
          refreshNavBadges();
        }}
      />
    </div>
  );
}
