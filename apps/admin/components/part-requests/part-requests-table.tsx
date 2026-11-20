'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Flag } from 'lucide-react';
import {
  PART_REQUEST_KINDS, PART_REQUEST_STATUSES,
  type AdminPartRequestList, type AdminPartRequestRow, type CategoryNode, type PartRequestKind, type PartRequestStatus,
} from '@mpm/shared-types';
import DataTable, { type Column } from '@/components/data-table';
import {
  ActiveChipsRow, FilterDialog, FiltersButton, SearchBox, Section, Segmented, useDraftCount, type ActiveChip,
} from '@/components/filter-kit';
import StatusBadge from '@/components/status-badge';
import { inputCls } from '@/components/ui/field-classes';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState } from '@/components/ui/states';
import { backLinkQuery } from '@/lib/back-link';
import { fetchAdminTree } from '@/lib/catalog-api';
import {
  ADMIN_PART_REQUEST_PAGE_SIZES, PART_REQUEST_KIND_LABELS, PART_REQUEST_STATUS_LABELS, fetchAdminPartRequests,
  formatRequestRef, isDay, isUuid, queryFromUrl, type PartRequestUrl,
} from '@/lib/part-requests-api';
import { partRequestStatusTone } from '@/lib/status';
import { positiveInt, useUrlState } from '@/lib/use-url-state';
import { formatDate } from '@/lib/utils';

const SEARCH_DELAY_MS = 300;
const SEARCH_MAX = 100;

const DEFAULTS: PartRequestUrl = {
  q: '', status: '', kind: '', machineCategoryId: '', reported: '', businessId: '', from: '', to: '', page: '1', pageSize: '25',
};

interface Draft { status: string; kind: string; machineCategoryId: string; reported: string; from: string; to: string }
const NO_FILTERS: Draft = { status: '', kind: '', machineCategoryId: '', reported: '', from: '', to: '' };

const countSelected = (d: Draft) =>
  [d.status, d.kind, d.machineCategoryId, d.reported, d.from || d.to].filter(Boolean).length;

const REPORTED_WORDS: Record<string, string> = { true: 'Has open reports', false: 'No open reports' };

/** Status, kind, machine category, reports and created dates; nothing reaches the table until Apply. */
function PartRequestFilterDialog({ start, base, categories, onClose, onApply }: {
  start: Draft;
  /** Search and buyer, kept while filtering. */
  base: PartRequestUrl;
  categories: CategoryNode[];
  onClose: () => void;
  onApply: (d: Draft) => void;
}) {
  const [draft, setDraft] = useState(start);
  const countMatches = useCallback(
    async (d: Draft) => (await fetchAdminPartRequests(queryFromUrl({ ...base, ...d, page: '1', pageSize: '25' }))).total,
    [base],
  );
  const matches = useDraftCount(draft, countMatches);

  return (
    <FilterDialog
      title="Filter part requests"
      wide
      selected={countSelected(draft)}
      matches={matches}
      itemLabel={['requirement', 'requirements']}
      onClear={() => setDraft(NO_FILTERS)}
      onClose={onClose}
      onApply={() => onApply(draft)}
    >
      <Section title="Status">
        <Segmented
          items={[['', 'Any'], ...PART_REQUEST_STATUSES.map((s) => [s, PART_REQUEST_STATUS_LABELS[s]] as [string, string])]}
          value={draft.status}
          onChange={(v) => setDraft({ ...draft, status: v })}
        />
      </Section>
      <Section title="Kind">
        <Segmented
          items={[['', 'Any'], ...PART_REQUEST_KINDS.map((k) => [k, PART_REQUEST_KIND_LABELS[k]] as [string, string])]}
          value={draft.kind}
          onChange={(v) => setDraft({ ...draft, kind: v })}
        />
      </Section>
      <Section title={<label htmlFor="pr-filter-category">Machine category</label>}>
        <select
          id="pr-filter-category"
          className={inputCls}
          value={draft.machineCategoryId}
          onChange={(e) => setDraft({ ...draft, machineCategoryId: e.target.value })}
        >
          <option value="">Any</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Section>
      <Section title="Reports">
        <Segmented
          items={[['', 'Any'], ['true', REPORTED_WORDS.true], ['false', REPORTED_WORDS.false]]}
          value={draft.reported}
          onChange={(v) => setDraft({ ...draft, reported: v })}
        />
      </Section>
      <Section title="Posted">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="pr-filter-from">Posted on or after</label>
          <input id="pr-filter-from" type="date" className={inputCls} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="text-sm text-gray-500">to</span>
          <label className="sr-only" htmlFor="pr-filter-to">Posted on or before</label>
          <input id="pr-filter-to" type="date" className={inputCls} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </div>
      </Section>
    </FilterDialog>
  );
}

/**
 * Part requests (F8 spec §14; textile `requirements-table.tsx`): every buyer requirement, active first then newest,
 * server-paged (25 / 50 / 100) with the filters, search (buyer business name or owner phone) and the buyer
 * (`?businessId=`, from a business page) in the URL. A row opens the requirement.
 */
export function PartRequestsTable() {
  const router = useRouter();
  const [url, setUrl, ready] = useUrlState(DEFAULTS, {
    validate: {
      status: ['', ...PART_REQUEST_STATUSES],
      kind: ['', ...PART_REQUEST_KINDS],
      machineCategoryId: (v) => v === '' || isUuid(v),
      businessId: (v) => v === '' || isUuid(v),
      reported: ['', 'true', 'false'],
      from: (v) => v === '' || isDay(v),
      to: (v) => v === '' || isDay(v),
      page: positiveInt,
      pageSize: ADMIN_PART_REQUEST_PAGE_SIZES.map(String),
    },
  });
  const query = useMemo(() => queryFromUrl(url), [url]);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AdminPartRequestList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchAdminPartRequests(query);
      if (ticket !== latest.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Could not load the part requests');
    }
  }, [query]);

  useEffect(() => { if (ready) void load(); }, [ready, load]);
  useEffect(() => { if (ready) setSearch(url.q); }, [ready, url.q]);
  useEffect(() => {
    if (!ready || search.trim() === url.q) return;
    const timer = setTimeout(() => setUrl({ q: search.trim(), page: '1' }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, search, url.q, setUrl]);
  // Machine category names for the filter and its chip; without them the filter lists none.
  useEffect(() => {
    fetchAdminTree().then(setCategories).catch(() => setCategories([]));
  }, []);

  const open = (row: AdminPartRequestRow) => {
    const here = `${window.location.pathname}${window.location.search}`;
    router.push(`/part-requests/${row.id}/?${backLinkQuery(here, 'Part requests')}`);
  };

  const columns: Column<AdminPartRequestRow>[] = [
    {
      key: 'name',
      header: 'Requirement',
      render: (r) => (
        <span className="min-w-0">
          <span className="block max-w-[16rem] truncate font-bold text-gray-900">{r.name}</span>
          <span className="block text-[13px] text-gray-500">
            <span className="font-mono">{formatRequestRef(r.ref)}</span> · {PART_REQUEST_KIND_LABELS[r.kind]}
          </span>
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (r) => <span className="block max-w-[14rem] truncate" title={r.categoryPath}>{r.categoryPath || '—'}</span>,
    },
    { key: 'buyer', header: 'Buyer', render: (r) => <span className="block max-w-[12rem] truncate">{r.buyer.name}</span> },
    { key: 'city', header: 'City', render: (r) => r.city ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.status} label={PART_REQUEST_STATUS_LABELS[r.status]} tone={partRequestStatusTone(r.status)} />,
    },
    { key: 'targeted', header: 'Targeted', headerTitle: 'Sellers told', className: 'tnum', render: (r) => r.targetedCount },
    { key: 'replies', header: 'Replies', className: 'tnum', render: (r) => r.replyCount },
    { key: 'matches', header: 'Matches', className: 'tnum', render: (r) => r.matchCount },
    {
      key: 'reports',
      header: 'Reports',
      className: 'tnum',
      render: (r) => (r.openReports > 0 ? (
        <span className="inline-flex items-center gap-1 text-[12px] font-bold text-red-600">
          <Flag size={12} aria-hidden /> {r.openReports}<span className="sr-only"> open reports</span>
        </span>
      ) : '—'),
    },
    { key: 'createdAt', header: 'Posted', className: 'tnum', render: (r) => formatDate(r.createdAt) },
    { key: 'expiresAt', header: 'Expires', className: 'tnum', render: (r) => formatDate(r.expiresAt) },
  ];

  const reset = (patch: Partial<PartRequestUrl>) => setUrl({ ...patch, page: '1' });
  const categoryName = categories.find((c) => c.id === url.machineCategoryId)?.name ?? 'Chosen category';
  // Every row of a buyer-filtered page has that buyer.
  const buyerName = data?.rows[0]?.buyer.businessId === url.businessId ? data.rows[0].buyer.name : 'One business';
  const chips: ActiveChip[] = [
    ...(url.businessId ? [{ key: 'businessId', label: 'Buyer', text: buyerName, remove: () => reset({ businessId: '' }) }] : []),
    ...(url.status ? [{ key: 'status', label: 'Status', text: PART_REQUEST_STATUS_LABELS[url.status as PartRequestStatus], remove: () => reset({ status: '' }) }] : []),
    ...(url.kind ? [{ key: 'kind', label: 'Kind', text: PART_REQUEST_KIND_LABELS[url.kind as PartRequestKind], remove: () => reset({ kind: '' }) }] : []),
    ...(url.machineCategoryId ? [{ key: 'machineCategoryId', label: 'Category', text: categoryName, remove: () => reset({ machineCategoryId: '' }) }] : []),
    ...(url.reported ? [{ key: 'reported', label: '', text: REPORTED_WORDS[url.reported], remove: () => reset({ reported: '' }) }] : []),
    ...(url.from || url.to
      ? [{
        key: 'dates',
        label: 'Posted',
        text: `${url.from ? formatDate(url.from) : 'any'} to ${url.to ? formatDate(url.to) : 'now'}`,
        remove: () => reset({ from: '', to: '' }),
      }]
      : []),
  ];

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <>
      {error && <StaleWarning thing="list" onRetry={() => void load()} />}
      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        loading={!data}
        onRowClick={open}
        page={data?.page ?? Number(url.page)}
        pageSize={Number(url.pageSize)}
        pageSizeOptions={ADMIN_PART_REQUEST_PAGE_SIZES}
        total={data?.total}
        onPageChange={(p) => setUrl({ page: String(p) })}
        onPageSizeChange={(size) => setUrl({ pageSize: String(size), page: '1' })}
        itemLabel="requirements"
        emptyMessage={url.q || chips.length > 0 ? 'No requirement matches' : 'No part requests yet'}
        toolbar={
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="Search by buyer business or owner phone"
                label="Search part requests by buyer business name or owner phone"
                maxLength={SEARCH_MAX}
              />
              <FiltersButton count={chips.filter((c) => c.key !== 'businessId').length} onClick={() => setFiltering(true)} />
            </div>
            {chips.length > 0 && (
              <div className="-mx-3 -mb-2.5 mt-2.5">
                <ActiveChipsRow chips={chips} onClearAll={() => reset({ ...NO_FILTERS, businessId: '' })} />
              </div>
            )}
          </div>
        }
      />
      {filtering && (
        <PartRequestFilterDialog
          start={{
            status: url.status, kind: url.kind, machineCategoryId: url.machineCategoryId, reported: url.reported, from: url.from, to: url.to,
          }}
          base={url}
          categories={categories}
          onClose={() => setFiltering(false)}
          onApply={(d) => {
            reset(d);
            setFiltering(false);
          }}
        />
      )}
    </>
  );
}
