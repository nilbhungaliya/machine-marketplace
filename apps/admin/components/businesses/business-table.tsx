'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ACCOUNT_STATUSES, VERIFICATION_STATUSES, type AccountStatus, type AdminBusinessList, type AdminBusinessRow,
  type VerificationStatus,
} from '@mpm/shared-types';
import DataTable, { type Column } from '@/components/data-table';
import {
  ActiveChipsRow, FilterDialog, FiltersButton, SearchBox, Section, Segmented, useDraftCount, type ActiveChip,
} from '@/components/filter-kit';
import StatusBadge from '@/components/status-badge';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState } from '@/components/ui/states';
import {
  ACCOUNT_STATUS_LABELS, VERIFICATION_LABELS, VERIFICATION_TONE, fetchBusinesses, type BusinessListQuery,
} from '@/lib/businesses-api';
import { useTablePageSize } from '@/lib/use-table-page-size';
import { positiveInt, useUrlState } from '@/lib/use-url-state';
import { formatDate, formatPhone } from '@/lib/utils';

const SEARCH_DELAY_MS = 300;

interface Filters {
  verification: string;
  status: string;
  city: string;
}

const NO_FILTERS: Filters = { verification: '', status: '', city: '' };

function toQuery(search: string, f: Filters): BusinessListQuery {
  return {
    search: search || undefined,
    verification: (f.verification || undefined) as VerificationStatus | undefined,
    status: (f.status || undefined) as AccountStatus | undefined,
    city: f.city.trim() || undefined,
  };
}

/**
 * Users & businesses (F1 + A2 spec §8.2): search by name, phone, GSTIN, city or industrial area; filter by verification, the owner's account
 * status and city; paged on the server. Search, filters and page live in the URL.
 */
export function BusinessTable() {
  const router = useRouter();
  const [url, setUrl, ready] = useUrlState(
    { q: '', verification: '', status: '', city: '', page: '1' },
    {
      validate: {
        verification: ['', ...VERIFICATION_STATUSES],
        status: ['', ...ACCOUNT_STATUSES],
        page: positiveInt,
      },
    },
  );
  const [pageSize, setPageSize] = useTablePageSize('businesses');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AdminBusinessList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const latest = useRef(0);
  const page = Number(url.page);
  const filters: Filters = { verification: url.verification, status: url.status, city: url.city };

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchBusinesses({
        ...toQuery(url.q, { verification: url.verification, status: url.status, city: url.city }),
        page,
        pageSize,
      });
      if (ticket !== latest.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Could not load the businesses');
    }
  }, [url.q, url.verification, url.status, url.city, page, pageSize]);

  useEffect(() => { if (ready) void load(); }, [ready, load]);
  useEffect(() => { if (ready) setSearch(url.q); }, [ready, url.q]);
  useEffect(() => {
    if (!ready || search.trim() === url.q) return;
    const timer = setTimeout(() => setUrl({ q: search.trim(), page: '1' }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, search, url.q, setUrl]);

  const columns: Column<AdminBusinessRow>[] = [
    {
      key: 'tradeName',
      header: 'Business',
      render: (b) => (
        <span className="font-medium text-gray-900">
          {b.tradeName}
          {b.legalName && b.legalName !== b.tradeName && <span className="block text-[13px] font-normal text-gray-500">{b.legalName}</span>}
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (b) => b.owner ? (
        <span>
          {b.owner.name ?? '—'}
          <span className="block text-[13px] text-gray-500 tnum">{formatPhone(b.owner.phone)}</span>
        </span>
      ) : '—',
    },
    { key: 'gstin', header: 'GSTIN', render: (b) => b.gstin ? <span className="font-mono text-[13px]">{b.gstin}</span> : '—' },
    {
      key: 'place',
      header: 'Place',
      render: (b) => (
        <span>
          {[b.city, b.state].filter(Boolean).join(', ') || '—'}
          {b.industrialArea && <span className="block text-[13px] text-gray-500">{b.industrialArea}</span>}
        </span>
      ),
    },
    {
      key: 'verificationStatus',
      header: 'GST',
      render: (b) => <StatusBadge status={b.verificationStatus} label={VERIFICATION_LABELS[b.verificationStatus]} tone={VERIFICATION_TONE[b.verificationStatus]} />,
    },
    {
      key: 'account',
      header: 'Account',
      render: (b) => b.owner ? <StatusBadge status={b.owner.status} label={ACCOUNT_STATUS_LABELS[b.owner.status]} /> : '—',
    },
    { key: 'createdAt', header: 'Joined', className: 'tnum', render: (b) => formatDate(b.createdAt) },
  ];

  const chips: ActiveChip[] = [
    ...(url.verification ? [{ key: 'verification', label: 'GST', text: VERIFICATION_LABELS[url.verification as VerificationStatus], remove: () => setUrl({ verification: '', page: '1' }) }] : []),
    ...(url.status ? [{ key: 'status', label: 'Account', text: ACCOUNT_STATUS_LABELS[url.status as AccountStatus], remove: () => setUrl({ status: '', page: '1' }) }] : []),
    ...(url.city ? [{ key: 'city', label: 'City', text: url.city, remove: () => setUrl({ city: '', page: '1' }) }] : []),
  ];

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;

  const filtered = !!url.q || chips.length > 0;

  return (
    <>
      {error && <StaleWarning thing="list" onRetry={() => void load()} />}
      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        loading={!data}
        onRowClick={(b) => router.push(`/businesses/${b.id}/`)}
        page={data?.page ?? page}
        pageSize={pageSize}
        total={data?.total}
        onPageChange={(p) => setUrl({ page: String(p) })}
        onPageSizeChange={(size) => { setPageSize(size); setUrl({ page: '1' }); }}
        itemLabel="businesses"
        emptyMessage={filtered ? 'No business matches' : 'No businesses yet'}
        toolbar={
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="Search by name, phone, GSTIN, city or industrial area"
                label="Search businesses by name, phone, GSTIN, city or industrial area"
              />
              <FiltersButton count={chips.length} onClick={() => setFiltering(true)} />
            </div>
            {chips.length > 0 && (
              <div className="-mx-3 -mb-2.5 mt-2.5">
                <ActiveChipsRow chips={chips} onClearAll={() => setUrl({ ...NO_FILTERS, page: '1' })} />
              </div>
            )}
          </div>
        }
      />
      {filtering && (
        <BusinessFilterDialog
          start={filters}
          search={url.q}
          onClose={() => setFiltering(false)}
          onApply={(f) => { setUrl({ ...f, city: f.city.trim(), page: '1' }); setFiltering(false); }}
        />
      )}
    </>
  );
}

/** The filter popup: nothing reaches the table until Apply; the button counts what the draft would show. */
function BusinessFilterDialog({ start, search, onClose, onApply }: {
  start: Filters;
  search: string;
  onClose: () => void;
  onApply: (f: Filters) => void;
}) {
  const [draft, setDraft] = useState<Filters>(start);
  const countMatches = useCallback(
    async (f: Filters) => (await fetchBusinesses({ ...toQuery(search, f), page: 1, pageSize: 1 })).total,
    [search],
  );
  const matches = useDraftCount(draft, countMatches);

  return (
    <FilterDialog
      title="Filter businesses"
      selected={[draft.verification, draft.status, draft.city.trim()].filter(Boolean).length}
      matches={matches}
      itemLabel={['business', 'businesses']}
      onClear={() => setDraft(NO_FILTERS)}
      onClose={onClose}
      onApply={() => onApply(draft)}
    >
      <Section title="GST verification">
        <Segmented
          items={[['', 'Any'], ...VERIFICATION_STATUSES.map((s) => [s, VERIFICATION_LABELS[s]] as [string, string])]}
          value={draft.verification}
          onChange={(v) => setDraft({ ...draft, verification: v })}
        />
      </Section>
      <Section title="Owner's account">
        <Segmented
          items={[['', 'Any'], ...ACCOUNT_STATUSES.map((s) => [s, ACCOUNT_STATUS_LABELS[s]] as [string, string])]}
          value={draft.status}
          onChange={(v) => setDraft({ ...draft, status: v })}
        />
      </Section>
      <Section title={<label htmlFor="filter-city">City</label>}>
        <input
          id="filter-city"
          className="w-full rounded-xl border-0 bg-gray-100 text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-brand-600"
          placeholder="e.g. Surat"
          value={draft.city}
          onChange={(e) => setDraft({ ...draft, city: e.target.value })}
        />
      </Section>
    </FilterDialog>
  );
}
