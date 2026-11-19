'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ENQUIRY_STATUSES, LISTING_KINDS, OFFER_STATUSES,
  type AdminEnquiryList, type AdminEnquiryRow, type EnquiryStatus, type ListingKind, type OfferStatus,
} from '@mpm/shared-types';
import DataTable, { type Column } from '@/components/data-table';
import {
  ActiveChipsRow, ChipGroup, FilterDialog, FiltersButton, SearchBox, Section, Segmented, useDraftCount, type ActiveChip,
} from '@/components/filter-kit';
import StatusBadge from '@/components/status-badge';
import { inputCls } from '@/components/ui/field-classes';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState } from '@/components/ui/states';
import { backLinkQuery } from '@/lib/back-link';
import { PARTY_SIDE_LABELS } from '@/lib/deals-api';
import {
  ADMIN_ENQUIRY_PAGE_SIZES, ENQUIRY_STATUS_LABELS, OFFER_STATUS_LABELS, OFFER_STATUS_TONES, dayBound, fetchAdminEnquiries,
  type AdminEnquiryQuery,
} from '@/lib/enquiries-api';
import { KIND_LABELS, formatPaise, formatRef } from '@/lib/listings-api';
import { positiveInt, useUrlState } from '@/lib/use-url-state';
import { formatDate, formatDateTime } from '@/lib/utils';

const SEARCH_DELAY_MS = 300;
const SEARCH_MAX = 100;
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

const DEFAULTS = { q: '', enquiryStatus: '', offerStatus: '', kind: '', from: '', to: '', page: '1', pageSize: '25' };
type UrlValues = typeof DEFAULTS;

interface Draft { enquiryStatus: string; offerStatus: string; kind: string; from: string; to: string }
const NO_FILTERS: Draft = { enquiryStatus: '', offerStatus: '', kind: '', from: '', to: '' };

/** The URL's strings as the API query (dates as the India-time day's bounds). */
export function enquiryQueryFromUrl(url: UrlValues): AdminEnquiryQuery {
  const q: AdminEnquiryQuery = { page: Number(url.page) || 1, pageSize: Number(url.pageSize) || 25 };
  if (url.q.trim()) q.q = url.q.trim();
  if (url.enquiryStatus) q.enquiryStatus = url.enquiryStatus as EnquiryStatus;
  if (url.offerStatus) q.offerStatus = url.offerStatus as OfferStatus;
  if (url.kind) q.kind = url.kind as ListingKind;
  if (url.from) q.from = dayBound(url.from, 'from');
  if (url.to) q.to = dayBound(url.to, 'to');
  return q;
}

const countSelected = (d: Draft) => [d.enquiryStatus, d.offerStatus, d.kind, d.from || d.to].filter(Boolean).length;

function EnquiryFilterDialog({ start, base, onClose, onApply }: {
  start: Draft;
  base: UrlValues;
  onClose: () => void;
  onApply: (d: Draft) => void;
}) {
  const [draft, setDraft] = useState(start);
  const countMatches = useCallback(
    async (d: Draft) => (await fetchAdminEnquiries(enquiryQueryFromUrl({ ...base, ...d, page: '1', pageSize: '25' }))).total,
    [base],
  );
  const matches = useDraftCount(draft, countMatches);
  return (
    <FilterDialog
      title="Filter enquiries"
      wide
      selected={countSelected(draft)}
      matches={matches}
      itemLabel={['conversation', 'conversations']}
      onClear={() => setDraft(NO_FILTERS)}
      onClose={onClose}
      onApply={() => onApply(draft)}
    >
      <Section title="Enquiry status">
        <Segmented
          items={[['', 'Any'], ...ENQUIRY_STATUSES.map((s) => [s, ENQUIRY_STATUS_LABELS[s]] as [string, string])]}
          value={draft.enquiryStatus}
          onChange={(v) => setDraft({ ...draft, enquiryStatus: v })}
        />
      </Section>
      <Section title="Kind">
        <Segmented
          items={[['', 'Any'], ...LISTING_KINDS.map((k) => [k, KIND_LABELS[k]] as [string, string])]}
          value={draft.kind}
          onChange={(v) => setDraft({ ...draft, kind: v })}
        />
      </Section>
      <Section title="Latest offer status">
        <ChipGroup
          small
          items={OFFER_STATUSES.map((s) => [s, OFFER_STATUS_LABELS[s]] as [string, string])}
          selected={draft.offerStatus ? [draft.offerStatus] : []}
          onToggle={(v) => setDraft({ ...draft, offerStatus: draft.offerStatus === v ? '' : v })}
        />
      </Section>
      <Section title="Started">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="enquiry-from">Started on or after</label>
          <input id="enquiry-from" type="date" className={inputCls} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="text-sm text-gray-500">to</span>
          <label className="sr-only" htmlFor="enquiry-to">Started on or before</label>
          <input id="enquiry-to" type="date" className={inputCls} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </div>
      </Section>
    </FilterDialog>
  );
}

/**
 * Enquiries & offers (F6 + F7 spec §16.1): every conversation with its listing, buyer, seller, derived enquiry status,
 * open negotiation (round, last price, quantity, turn, expiry), deals, start and last activity. Server-paged with the
 * filters in the URL. Read-only and text-free: a row opens the offer chain.
 */
export function EnquiriesTable() {
  const router = useRouter();
  const [url, setUrl, ready] = useUrlState(DEFAULTS, {
    validate: {
      enquiryStatus: ['', ...ENQUIRY_STATUSES],
      offerStatus: ['', ...OFFER_STATUSES],
      kind: ['', ...LISTING_KINDS],
      from: (v) => v === '' || isDay(v),
      to: (v) => v === '' || isDay(v),
      page: positiveInt,
      pageSize: ADMIN_ENQUIRY_PAGE_SIZES.map(String),
    },
  });
  const query = useMemo(() => enquiryQueryFromUrl(url), [url]);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AdminEnquiryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchAdminEnquiries(query);
      if (ticket !== latest.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Could not load the enquiries');
    }
  }, [query]);

  useEffect(() => { if (ready) void load(); }, [ready, load]);
  useEffect(() => { if (ready) setSearch(url.q); }, [ready, url.q]);
  useEffect(() => {
    if (!ready || search.trim() === url.q) return;
    const timer = setTimeout(() => setUrl({ q: search.trim(), page: '1' }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, search, url.q, setUrl]);

  const open = (row: AdminEnquiryRow) => {
    const here = `${window.location.pathname}${window.location.search}`;
    router.push(`/enquiries/${row.threadId}/?${backLinkQuery(here, 'Enquiries & offers')}`);
  };

  const columns: Column<AdminEnquiryRow>[] = [
    {
      key: 'listing',
      header: 'Listing',
      render: (r) => (
        <span className="min-w-0">
          <span className="block max-w-[16rem] truncate font-bold text-gray-900">{r.listing.title}</span>
          <span className="block text-[13px] text-gray-500"><span className="font-mono">{formatRef(r.listing.ref)}</span> · {KIND_LABELS[r.listing.kind]}</span>
        </span>
      ),
    },
    { key: 'buyer', header: 'Buyer', render: (r) => <span className="block max-w-[11rem] truncate">{r.buyer.name}</span> },
    { key: 'seller', header: 'Seller', render: (r) => <span className="block max-w-[11rem] truncate">{r.seller.name}</span> },
    { key: 'status', header: 'Enquiry', render: (r) => <StatusBadge status={r.enquiryStatus} label={ENQUIRY_STATUS_LABELS[r.enquiryStatus]} /> },
    {
      key: 'negotiation',
      header: 'Negotiation',
      render: (r) => {
        const n = r.negotiation;
        if (!n) return <span className="text-gray-500">—</span>;
        return (
          <span className="block">
            <span className="flex items-center gap-1.5">
              <StatusBadge status={n.status} label={OFFER_STATUS_LABELS[n.status]} tone={OFFER_STATUS_TONES[n.status]} />
              <span className="text-[12.5px] text-gray-500">Round {n.round}</span>
            </span>
            <span className="block text-[13px] text-gray-700 tnum">
              {formatPaise(n.lastPricePerUnitPaise)} × {n.quantity} · {PARTY_SIDE_LABELS[n.turn]}&apos;s turn
            </span>
            {n.expiresAt && <span className="block text-[12.5px] text-gray-500 tnum">Expires {formatDateTime(n.expiresAt)}</span>}
          </span>
        );
      },
    },
    { key: 'deals', header: 'Deals', className: 'tnum', render: (r) => r.dealCount || '—' },
    { key: 'createdAt', header: 'Started', className: 'tnum', render: (r) => formatDate(r.createdAt) },
    { key: 'lastActivityAt', header: 'Last activity', className: 'tnum', render: (r) => formatDateTime(r.lastActivityAt) },
  ];

  const reset = (patch: Partial<UrlValues>) => setUrl({ ...patch, page: '1' });
  const chips: ActiveChip[] = [
    ...(url.enquiryStatus ? [{ key: 'enquiryStatus', label: 'Enquiry', text: ENQUIRY_STATUS_LABELS[url.enquiryStatus as EnquiryStatus], remove: () => reset({ enquiryStatus: '' }) }] : []),
    ...(url.offerStatus ? [{ key: 'offerStatus', label: 'Offer', text: OFFER_STATUS_LABELS[url.offerStatus as OfferStatus], remove: () => reset({ offerStatus: '' }) }] : []),
    ...(url.kind ? [{ key: 'kind', label: 'Kind', text: KIND_LABELS[url.kind as ListingKind], remove: () => reset({ kind: '' }) }] : []),
    ...(url.from || url.to
      ? [{
        key: 'dates',
        label: 'Started',
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
        pageSizeOptions={ADMIN_ENQUIRY_PAGE_SIZES}
        total={data?.total}
        onPageChange={(p) => setUrl({ page: String(p) })}
        onPageSizeChange={(size) => setUrl({ pageSize: String(size), page: '1' })}
        itemLabel="conversations"
        emptyMessage={url.q || chips.length > 0 ? 'No conversation matches' : 'No enquiries yet'}
        toolbar={
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="Search by buyer or seller business"
                label="Search enquiries by buyer or seller business name"
                maxLength={SEARCH_MAX}
              />
              <FiltersButton count={chips.length} onClick={() => setFiltering(true)} />
            </div>
            {chips.length > 0 && (
              <div className="-mx-3 -mb-2.5 mt-2.5">
                <ActiveChipsRow chips={chips} onClearAll={() => reset({ enquiryStatus: '', offerStatus: '', kind: '', from: '', to: '' })} />
              </div>
            )}
          </div>
        }
      />
      {filtering && (
        <EnquiryFilterDialog
          start={{ enquiryStatus: url.enquiryStatus, offerStatus: url.offerStatus, kind: url.kind, from: url.from, to: url.to }}
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
