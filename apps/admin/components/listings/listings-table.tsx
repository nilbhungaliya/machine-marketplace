'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Flag, ImageOff } from 'lucide-react';
import {
  ADMIN_LISTING_BULK_MAX, ADMIN_LISTING_PAGE_SIZES, LISTING_FLAGS, LISTING_KINDS, LISTING_STATUSES, PART_SIDES,
  type AdminListingBulkAction, type AdminListingFilters, type AdminListingList, type AdminListingRow, type CategoryNode,
  type ListingFlag, type ListingStatus,
} from '@mpm/shared-types';
import DataTable, { type Column } from '@/components/data-table';
import { ActiveChipsRow, FiltersButton, SearchBox, type ActiveChip } from '@/components/filter-kit';
import StatusBadge from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { checkCls } from '@/components/ui/field-classes';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { backLinkQuery } from '@/lib/back-link';
import { fetchAdminTree } from '@/lib/catalog-api';
import {
  FLAG_LABELS, KIND_LABELS, RENTAL_PERIOD_LABELS, SIDE_LABELS, fetchAdminListings, filtersFromUrl, formatPaise, formatRef,
} from '@/lib/listings-api';
import { LISTING_STATUS_LABELS } from '@/lib/status';
import { positiveInt, useUrlState } from '@/lib/use-url-state';
import { formatDate } from '@/lib/utils';
import { BulkActionDialog } from './bulk-action-dialog';
import { ListingFilterDialog, NO_LISTING_FILTERS, type ListingFilterDraft } from './listings-filters';

const SEARCH_DELAY_MS = 300;

const listOf = (allowed: readonly string[]) => (v: string) => v.split(',').every((x) => allowed.includes(x));

const DEFAULTS = {
  q: '', status: '', kind: '', machineCategoryId: '', city: '', side: '', flags: '', reported: '', businessId: '',
  page: '1', pageSize: '25',
};

function price(row: AdminListingRow): string {
  if (row.rate) return `${formatPaise(row.rate.paise)} a ${RENTAL_PERIOD_LABELS[row.rate.period]}`;
  if (row.priceModel === 'on_request') return 'On request';
  return row.pricePaise != null ? formatPaise(row.pricePaise) : '—';
}

/**
 * Parts & machinery (F2 spec §11.4): every listing, paged on the server (25 / 50 / 100), with search, filters in the URL
 * (status and flags as comma lists, `reported=1`, the seller as a removable chip) and, for moderators, checkbox
 * selection with bulk Hide / Remove. A row opens the listing's review screen.
 */
export function ListingsTable() {
  const router = useRouter();
  const { hasRole } = useAuth();
  const canAct = hasRole('moderator');
  const [url, setUrl, ready] = useUrlState(DEFAULTS, {
    validate: {
      status: listOf(LISTING_STATUSES),
      kind: ['', ...LISTING_KINDS],
      side: ['', ...PART_SIDES],
      flags: listOf(LISTING_FLAGS),
      reported: ['', '1'],
      page: positiveInt,
      pageSize: ADMIN_LISTING_PAGE_SIZES.map(String),
    },
  });
  const filters = useMemo(() => filtersFromUrl(url), [url]);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AdminListingList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ action: AdminListingBulkAction; rows: AdminListingRow[] } | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchAdminListings(filters);
      if (ticket !== latest.current) return;
      setData(next);
      setError(null);
      // A new page or filter shows other rows: keep only what is still on screen.
      setSelected((prev) => new Set(next.rows.filter((r) => prev.has(r.id)).map((r) => r.id)));
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Could not load the listings');
    }
  }, [filters]);

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

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const chosen = rows.filter((r) => selected.has(r.id));
  const tooMany = chosen.length > ADMIN_LISTING_BULK_MAX;

  const open = (row: AdminListingRow) => {
    const here = `${window.location.pathname}${window.location.search}`;
    router.push(`/listings/${row.id}/?${backLinkQuery(here, 'Parts & machinery')}`);
  };

  const columns: Column<AdminListingRow>[] = [
    {
      key: 'title',
      header: 'Listing',
      render: (r) => (
        <span className="flex items-center gap-3">
          {canAct && (
            // Selecting must not open the row.
            <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex">
              <input
                type="checkbox"
                className={checkCls}
                aria-label={`Select ${r.title}`}
                checked={selected.has(r.id)}
                onChange={() => toggle(r.id)}
              />
            </span>
          )}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-photo">
            {r.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.thumbUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImageOff size={14} aria-hidden className="text-gray-400" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block max-w-[18rem] truncate font-bold text-gray-900">{r.title}</span>
            <span className="block text-[13px] text-gray-500"><span className="font-mono">{formatRef(r.ref)}</span> · {KIND_LABELS[r.kind]}</span>
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} label={LISTING_STATUS_LABELS[r.status]} /> },
    {
      key: 'category',
      header: 'Category',
      render: (r) => <span className="block max-w-[14rem] truncate" title={r.categoryPath.join(' › ')}>{r.categoryPath.slice(0, 2).join(' › ') || '—'}</span>,
    },
    { key: 'city', header: 'City', render: (r) => r.city ?? '—' },
    { key: 'side', header: 'Side', render: (r) => (r.side && r.side !== 'not_applicable' ? SIDE_LABELS[r.side] : '—') },
    { key: 'seller', header: 'Seller', render: (r) => <span className="block max-w-[12rem] truncate">{r.business.name}</span> },
    { key: 'price', header: 'Price', className: 'tnum', render: price },
    {
      key: 'flags',
      header: 'Flags',
      render: (r) => (
        <span className="flex items-center gap-1.5">
          {r.flags.map((f) => (
            <span key={f} className="rounded-full bg-amber-50 px-2 py-px text-[11px] font-bold text-amber-800">{FLAG_LABELS[f]}</span>
          ))}
          {r.openReports > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] font-bold text-red-600">
              <Flag size={12} aria-hidden /> {r.openReports}<span className="sr-only"> open reports</span>
            </span>
          )}
          {r.flags.length === 0 && r.openReports === 0 && '—'}
        </span>
      ),
    },
    { key: 'updatedAt', header: 'Updated', className: 'tnum', render: (r) => formatDate(r.updatedAt) },
  ];

  const categoryName = categories.find((c) => c.id === url.machineCategoryId)?.name ?? 'Chosen category';
  const reset = (patch: Partial<typeof DEFAULTS>) => setUrl({ ...patch, page: '1' });
  const chips: ActiveChip[] = [
    ...(url.businessId ? [{ key: 'businessId', label: 'Seller', text: data?.business?.name ?? 'One business', remove: () => reset({ businessId: '' }) }] : []),
    ...(filters.status ? [{ key: 'status', label: 'Status', text: filters.status.map((s: ListingStatus) => LISTING_STATUS_LABELS[s]).join(', '), remove: () => reset({ status: '' }) }] : []),
    ...(filters.kind ? [{ key: 'kind', label: 'Kind', text: KIND_LABELS[filters.kind], remove: () => reset({ kind: '' }) }] : []),
    ...(url.machineCategoryId ? [{ key: 'machineCategoryId', label: 'Category', text: categoryName, remove: () => reset({ machineCategoryId: '' }) }] : []),
    ...(filters.city ? [{ key: 'city', label: 'City', text: filters.city, remove: () => reset({ city: '' }) }] : []),
    ...(filters.side ? [{ key: 'side', label: 'Side', text: SIDE_LABELS[filters.side], remove: () => reset({ side: '' }) }] : []),
    ...(filters.flags ? [{ key: 'flags', label: 'Flags', text: filters.flags.map((f: ListingFlag) => FLAG_LABELS[f]).join(', '), remove: () => reset({ flags: '' }) }] : []),
    ...(filters.reported ? [{ key: 'reported', label: '', text: 'Has open reports', remove: () => reset({ reported: '' }) }] : []),
  ];

  const draft: ListingFilterDraft = {
    status: filters.status ?? [],
    kind: filters.kind ?? '',
    machineCategoryId: url.machineCategoryId,
    city: filters.city ?? '',
    side: filters.side ?? '',
    flags: filters.flags ?? [],
    reported: !!filters.reported,
  };
  const base: AdminListingFilters = { q: filters.q, businessId: filters.businessId };

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;

  const filtered = !!url.q || chips.length > 0;
  const pageSize = Number(url.pageSize);

  return (
    <>
      {error && <StaleWarning thing="list" onRetry={() => void load()} />}
      <DataTable
        columns={columns}
        data={rows}
        loading={!data}
        onRowClick={open}
        page={data?.page ?? Number(url.page)}
        pageSize={pageSize}
        pageSizeOptions={ADMIN_LISTING_PAGE_SIZES}
        total={data?.total}
        onPageChange={(p) => setUrl({ page: String(p) })}
        onPageSizeChange={(size) => setUrl({ pageSize: String(size), page: '1' })}
        itemLabel="listings"
        emptyMessage={filtered ? 'No listing matches' : 'No listings yet'}
        toolbar={
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {canAct && rows.length > 0 && (
                <input
                  type="checkbox"
                  className={checkCls}
                  aria-label="Select every listing on this page"
                  checked={allOn}
                  onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              )}
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="Search by title, part number, #ref or business"
                label="Search listings by title, part number, reference or business name"
              />
              <FiltersButton count={chips.filter((c) => c.key !== 'businessId').length} onClick={() => setFiltering(true)} />
            </div>
            {canAct && chosen.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm">
                <span className="font-bold text-brand-700">{chosen.length} selected</span>
                {tooMany && <span className="text-[13px] font-semibold text-red-600">At most {ADMIN_LISTING_BULK_MAX} at a time.</span>}
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                  <Button size="sm" variant="secondary" disabled={tooMany} onClick={() => setBulk({ action: 'hide', rows: chosen })}>
                    Hide selected ({chosen.length})
                  </Button>
                  <Button size="sm" variant="danger" disabled={tooMany} onClick={() => setBulk({ action: 'remove', rows: chosen })}>
                    Remove selected ({chosen.length})
                  </Button>
                </span>
              </div>
            )}
            {chips.length > 0 && (
              <div className="-mx-3 -mb-2.5 mt-2.5">
                <ActiveChipsRow
                  chips={chips}
                  onClearAll={() => reset({ ...NO_URL_FILTERS, businessId: '' })}
                />
              </div>
            )}
          </div>
        }
      />
      {filtering && (
        <ListingFilterDialog
          start={draft}
          base={base}
          categories={categories}
          onClose={() => setFiltering(false)}
          onApply={(d) => {
            setUrl({
              status: d.status.join(','),
              kind: d.kind,
              machineCategoryId: d.machineCategoryId,
              city: d.city.trim(),
              side: d.side,
              flags: d.flags.join(','),
              reported: d.reported ? '1' : '',
              page: '1',
            });
            setFiltering(false);
          }}
        />
      )}
      {bulk && (
        <BulkActionDialog
          action={bulk.action}
          rows={bulk.rows}
          onClose={() => setBulk(null)}
          onDone={() => { setSelected(new Set()); void load(); }}
        />
      )}
    </>
  );
}

/** Every popup filter cleared, as URL values. */
const NO_URL_FILTERS = {
  status: '', kind: '', machineCategoryId: NO_LISTING_FILTERS.machineCategoryId, city: '', side: '', flags: '', reported: '',
};
