'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { AdminDealDetail } from '@mpm/shared-types';
import { DealDetail } from '@/components/deals/deal-detail';
import StatusBadge from '@/components/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { useBackTarget } from '@/lib/back-link';
import { DEAL_STATUS_LABELS, DEAL_STATUS_TONES, fetchAdminDeal, formatDealRef } from '@/lib/deals-api';
import { classifyLoadError } from '@/lib/load-error';

const LOAD_MESSAGES = {
  not_found: 'This deal does not exist.',
  forbidden: "Your role can't open deals.",
  failed: 'Check your connection and try again.',
};

/** One deal (F6 + F7 spec §16.1). */
export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const back = useBackTarget({ href: '/deals/', label: 'Deals' });
  const { hasRole } = useAuth();
  const [deal, setDeal] = useState<AdminDealDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchAdminDeal(id);
      if (ticket !== latest.current) return;
      setDeal(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (!deal || deal.id !== id) {
    return error ? (
      <ErrorState title="Couldn't open this deal" message={LOAD_MESSAGES[classifyLoadError(error)]} onRetry={() => void load()} />
    ) : (
      <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={6} cols={3} /></div>
    );
  }

  return (
    <div>
      <PageHeader
        back={back}
        trail={[formatDealRef(deal.ref)]}
        title={<span>Deal <span className="font-mono">{formatDealRef(deal.ref)}</span></span>}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{deal.listing.title}</span>
            <StatusBadge status={deal.status} label={DEAL_STATUS_LABELS[deal.status]} tone={DEAL_STATUS_TONES[deal.status]} />
          </span>
        }
      />
      {error !== null && <StaleWarning thing="deal" onRetry={() => void load()} />}
      {/* Disputes is support's queue (§16.1): operations sees the list without the link. */}
      <DealDetail deal={deal} canOpenDisputes={hasRole('support')} />
    </div>
  );
}
