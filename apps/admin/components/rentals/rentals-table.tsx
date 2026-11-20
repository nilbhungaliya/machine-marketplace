'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  RENTAL_BOOKING_STATUSES, type AdminRentalBookingList, type AdminRentalBookingRow, type RentalBookingStatus,
} from '@mpm/shared-types';
import DataTable, { type Column } from '@/components/data-table';
import {
  ActiveChipsRow, FilterDialog, FiltersButton, SearchBox, Section, useDraftCount, type ActiveChip,
} from '@/components/filter-kit';
import StatusBadge from '@/components/status-badge';
import { inputCls } from '@/components/ui/field-classes';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState } from '@/components/ui/states';
import { backLinkQuery } from '@/lib/back-link';
import { formatPaise } from '@/lib/listings-api';
import {
  ADMIN_RENTAL_PAGE_SIZES, fetchAdminRentals, formatBookingRef, formatDay, formatDayRange, isDay, isUuid, queryFromUrl,
  type RentalUrl,
} from '@/lib/rentals-api';
import { getAdminSocket } from '@/lib/socket';
import { RENTAL_BOOKING_STATUS_LABELS, rentalBookingStatusTone } from '@/lib/status';
import { positiveInt, useUrlState } from '@/lib/use-url-state';
import { formatDateTime } from '@/lib/utils';

const SEARCH_DELAY_MS = 300;
const SEARCH_MAX = 100;

const DEFAULTS: RentalUrl = {
  q: '', status: '', from: '', to: '', businessId: '', listingId: '', page: '1', pageSize: '25',
};

interface Draft { status: string; from: string; to: string }
const NO_FILTERS: Draft = { status: '', from: '', to: '' };

const countSelected = (d: Draft) => [d.status, d.from || d.to].filter(Boolean).length;

/** Status and start dates; nothing reaches the table until Apply. */
function RentalFilterDialog({ start, base, onClose, onApply }: {
  start: Draft;
  /** Search, business and listing, kept while filtering. */
  base: RentalUrl;
  onClose: () => void;
  onApply: (d: Draft) => void;
}) {
  const [draft, setDraft] = useState(start);
  const countMatches = useCallback(
    async (d: Draft) => (await fetchAdminRentals(queryFromUrl({ ...base, ...d, page: '1', pageSize: '25' }))).total,
    [base],
  );
  const matches = useDraftCount(draft, countMatches);

  return (
    <FilterDialog
      title="Filter rental bookings"
      selected={countSelected(draft)}
      matches={matches}
      itemLabel={['booking', 'bookings']}
      onClear={() => setDraft(NO_FILTERS)}
      onClose={onClose}
      onApply={() => onApply(draft)}
    >
      <Section title={<label htmlFor="rb-filter-status">Status</label>}>
        <select
          id="rb-filter-status"
          className={inputCls}
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
        >
          <option value="">Any</option>
          {RENTAL_BOOKING_STATUSES.map((s) => <option key={s} value={s}>{RENTAL_BOOKING_STATUS_LABELS[s]}</option>)}
        </select>
      </Section>
      <Section title="Starts">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="rb-filter-from">Starts on or after</label>
          <input id="rb-filter-from" type="date" className={inputCls} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="text-sm text-gray-500">to</span>
          <label className="sr-only" htmlFor="rb-filter-to">Starts on or before</label>
          <input id="rb-filter-to" type="date" className={inputCls} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </div>
      </Section>
    </FilterDialog>
  );
}

/**
 * Rental bookings (M14 spec §15, R15; the F8 part requests table's pattern): every booking, newest change first,
 * server-paged (25 / 50 / 100) with status, start dates, search (ref, business or listing) and the business or listing
 * (`?businessId=` / `?listingId=`, from a business or listing page) in the URL. A `rental:updated` event reloads it.
 */
export function RentalsTable() {
  const router = useRouter();
  const [url, setUrl, ready] = useUrlState(DEFAULTS, {
    validate: {
      status: ['', ...RENTAL_BOOKING_STATUSES],
      from: (v) => v === '' || isDay(v),
      to: (v) => v === '' || isDay(v),
      businessId: (v) => v === '' || isUuid(v),
      listingId: (v) => v === '' || isUuid(v),
      page: positiveInt,
      pageSize: ADMIN_RENTAL_PAGE_SIZES.map(String),
    },
  });
  const query = useMemo(() => queryFromUrl(url), [url]);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AdminRentalBookingList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchAdminRentals(query);
      if (ticket !== latest.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Could not load the rental bookings');
    }
  }, [query]);

  useEffect(() => { if (ready) void load(); }, [ready, load]);
  useEffect(() => { if (ready) setSearch(url.q); }, [ready, url.q]);
  useEffect(() => {
    if (!ready || search.trim() === url.q) return;
    const timer = setTimeout(() => setUrl({ q: search.trim(), page: '1' }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, search, url.q, setUrl]);

  // Live refresh (§12): the API sends `rental:updated` (ids only) to the operations and support rooms on every
  // booking change. Keep the newest `load` without re-subscribing on every filter change.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    const socket = getAdminSocket();
    const onUpdated = () => { void loadRef.current(); };
    socket.on('rental:updated', onUpdated);
    return () => { socket.off('rental:updated', onUpdated); };
  }, []);

  const open = (row: AdminRentalBookingRow) => {
    const here = `${window.location.pathname}${window.location.search}`;
    router.push(`/rentals/${row.id}/?${backLinkQuery(here, 'Rental bookings')}`);
  };

  const columns: Column<AdminRentalBookingRow>[] = [
    { key: 'ref', header: 'Booking', render: (r) => <span className="font-mono font-semibold text-gray-900">{formatBookingRef(r.ref)}</span> },
    { key: 'listing', header: 'Machine', render: (r) => <span className="block max-w-[14rem] truncate font-bold text-gray-900" title={r.listing.title}>{r.listing.title}</span> },
    { key: 'renter', header: 'Renter', render: (r) => <span className="block max-w-[11rem] truncate">{r.renter.name}</span> },
    { key: 'owner', header: 'Owner', render: (r) => <span className="block max-w-[11rem] truncate">{r.owner.name}</span> },
    { key: 'dates', header: 'Dates', className: 'tnum', render: (r) => formatDayRange(r.startDate, r.endDate) },
    { key: 'machines', header: 'Machines', className: 'tnum', render: (r) => r.machines },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.status} label={RENTAL_BOOKING_STATUS_LABELS[r.status]} tone={rentalBookingStatusTone(r.status)} />,
    },
    { key: 'total', header: 'Agreed total', className: 'tnum', render: (r) => (r.agreedTotalPaise !== null ? formatPaise(r.agreedTotalPaise) : '—') },
    { key: 'updatedAt', header: 'Updated', className: 'tnum', render: (r) => formatDateTime(r.updatedAt) },
  ];

  const reset = (patch: Partial<RentalUrl>) => setUrl({ ...patch, page: '1' });
  // Every row of a business-filtered page has that business on one side.
  const firstRow = data?.rows[0];
  const businessName = firstRow
    ? (firstRow.renter.businessId === url.businessId ? firstRow.renter.name : firstRow.owner.businessId === url.businessId ? firstRow.owner.name : 'One business')
    : 'One business';
  const listingName = firstRow?.listing.id === url.listingId ? firstRow.listing.title : 'One listing';
  const chips: ActiveChip[] = [
    ...(url.businessId ? [{ key: 'businessId', label: 'Business', text: businessName, remove: () => reset({ businessId: '' }) }] : []),
    ...(url.listingId ? [{ key: 'listingId', label: 'Listing', text: listingName, remove: () => reset({ listingId: '' }) }] : []),
    ...(url.status ? [{ key: 'status', label: 'Status', text: RENTAL_BOOKING_STATUS_LABELS[url.status as RentalBookingStatus], remove: () => reset({ status: '' }) }] : []),
    ...(url.from || url.to
      ? [{
        key: 'dates',
        label: 'Starts',
        text: `${url.from ? formatDay(url.from) : 'any'} to ${url.to ? formatDay(url.to) : 'any'}`,
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
        pageSizeOptions={ADMIN_RENTAL_PAGE_SIZES}
        total={data?.total}
        onPageChange={(p) => setUrl({ page: String(p) })}
        onPageSizeChange={(size) => setUrl({ pageSize: String(size), page: '1' })}
        itemLabel="bookings"
        emptyMessage={url.q || chips.length > 0 ? 'No booking matches' : 'No rental bookings yet'}
        toolbar={
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="Search by #ref, business or machine"
                label="Search rental bookings by booking reference, business name or listing title"
                maxLength={SEARCH_MAX}
              />
              <FiltersButton count={chips.filter((c) => c.key !== 'businessId' && c.key !== 'listingId').length} onClick={() => setFiltering(true)} />
            </div>
            {chips.length > 0 && (
              <div className="-mx-3 -mb-2.5 mt-2.5">
                <ActiveChipsRow chips={chips} onClearAll={() => reset({ ...NO_FILTERS, businessId: '', listingId: '' })} />
              </div>
            )}
          </div>
        }
      />
      {filtering && (
        <RentalFilterDialog
          start={{ status: url.status, from: url.from, to: url.to }}
          base={url}
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
