'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { AdminBusinessDetail } from '@mpm/shared-types';
import { BusinessDetail } from '@/components/businesses/business-detail';
import StatusBadge from '@/components/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { useBackTarget } from '@/lib/back-link';
import { VERIFICATION_LABELS, VERIFICATION_TONE, fetchBusiness, fetchCategoryNames } from '@/lib/businesses-api';
import { classifyLoadError } from '@/lib/load-error';

const LOAD_MESSAGES = {
  not_found: 'This business does not exist.',
  forbidden: "Your role can't open businesses.",
  failed: 'Check your connection and try again.',
};

/** One business (F1 + A2 spec §8.2). */
export default function BusinessPage() {
  const { id } = useParams<{ id: string }>();
  const back = useBackTarget({ href: '/businesses/', label: 'Users & businesses' });
  const [business, setBusiness] = useState<AdminBusinessDetail | null>(null);
  const [categoryNames, setCategoryNames] = useState<Map<string, string> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchBusiness(id);
      if (ticket !== latest.current) return;
      setBusiness(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  // The names are a nicety: without them the panel says how many categories there are.
  useEffect(() => {
    fetchCategoryNames().then(setCategoryNames).catch(() => setCategoryNames(null));
  }, []);

  if (!business || business.profile.id !== id) {
    return error ? (
      <ErrorState title="Couldn't open this business" message={LOAD_MESSAGES[classifyLoadError(error)]} onRetry={() => void load()} />
    ) : (
      <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={6} cols={3} /></div>
    );
  }

  const p = business.profile;
  return (
    <div>
      <PageHeader
        back={back}
        trail={[p.displayName]}
        title={p.displayName}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {p.legalName && p.legalName !== p.displayName && <span>{p.legalName}</span>}
            <StatusBadge status={p.verificationStatus} label={VERIFICATION_LABELS[p.verificationStatus]} tone={VERIFICATION_TONE[p.verificationStatus]} />
          </span>
        }
      />
      {error !== null && <StaleWarning thing="business" onRetry={() => void load()} />}
      <BusinessDetail business={business} categoryNames={categoryNames} onChanged={() => void load()} />
    </div>
  );
}
