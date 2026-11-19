'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { AdminEnquiryDetail } from '@mpm/shared-types';
import { OfferChain } from '@/components/enquiries/offer-chain';
import { PageHeader } from '@/components/ui/page-header';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { useBackTarget } from '@/lib/back-link';
import { fetchAdminEnquiry } from '@/lib/enquiries-api';
import { formatRef } from '@/lib/listings-api';
import { classifyLoadError } from '@/lib/load-error';

const LOAD_MESSAGES = {
  not_found: 'This conversation does not exist.',
  forbidden: "Your role can't open enquiries.",
  failed: 'Check your connection and try again.',
};

/** One conversation's offer chain (F6 + F7 spec §16.1), without text. */
export default function EnquiryPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const back = useBackTarget({ href: '/enquiries/', label: 'Enquiries & offers' });
  const { hasRole } = useAuth();
  const [detail, setDetail] = useState<AdminEnquiryDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchAdminEnquiry(threadId);
      if (ticket !== latest.current) return;
      setDetail(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err);
    }
  }, [threadId]);

  useEffect(() => { void load(); }, [load]);

  if (!detail || detail.row.threadId !== threadId) {
    return error ? (
      <ErrorState title="Couldn't open this conversation" message={LOAD_MESSAGES[classifyLoadError(error)]} onRetry={() => void load()} />
    ) : (
      <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={6} cols={3} /></div>
    );
  }

  const { row } = detail;
  return (
    <div>
      <PageHeader
        back={back}
        trail={[formatRef(row.listing.ref)]}
        title={row.listing.title}
        description={`${row.buyer.name} buying from ${row.seller.name}`}
      />
      {error !== null && <StaleWarning thing="conversation" onRetry={() => void load()} />}
      {/* Deals is the same roles as this page (support, operations). */}
      <OfferChain detail={detail} canOpenDeals={hasRole('support', 'operations')} />
    </div>
  );
}
