'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEAL_STATUSES, type AdminDealList, type AdminDealRow, type DealStatus } from '@mpm/shared-types';
import DataTable, { type Column } from '@/components/data-table';
import { SearchBox } from '@/components/filter-kit';
import StatusBadge from '@/components/status-badge';
import { inputCls } from '@/components/ui/field-classes';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { backLinkQuery } from '@/lib/back-link';
import {
  ADMIN_DEAL_PAGE_SIZES, DEAL_STATUS_LABELS, DEAL_STATUS_TONES, DEAL_STATUS_TABS, fetchAdminDeals, formatDealRef, formatPaiseString,
  type AdminDealQuery,
} from '@/lib/deals-api';
import { formatPaise, formatRef } from '@/lib/listings-api';
import { positiveInt, useUrlState } from '@/lib/use-url-state';
import { cn, formatDate } from '@/lib/utils';

const SEARCH_DELAY_MS = 300;
const SEARCH_MAX = 100;
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

const DEFAULTS = { status: '', search: '', from: '', to: '', page: '1', pageSize: '25' };

type Tab = '' | DealStatus;

/**
 * Deals (F6 + F7 spec §16.1): status tabs (Agreed, Handed over, Disputed, Completed, Cancelled) with their counts,
 * search by deal ref, business or listing, the accepted-on dates, and the totals in Indian format. Read-only: a row opens
 * the deal record; actions live in Disputes.
 */
export function DealsTable() {
  const router = useRouter();
  const [url, setUrl, ready] = useUrlState(DEFAULTS, {
    validate: {
      status: ['', ...DEAL_STATUSES],
      from: (v) => v === '' || isDay(v),
      to: (v) => v === '' || isDay(v),
      page: positiveInt,
      pageSize: ADMIN_DEAL_PAGE_SIZES.map(String),
    },
  });
  const query = useMemo<AdminDealQuery>(() => ({
    status: (url.status || undefined) as DealStatus | undefined,
    search: url.search || undefined,
    from: url.from || undefined,
    to: url.to || undefined,
    page: Number(url.page),
    pageSize: Number(url.pageSize),
  }), [url]);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AdminDealList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchAdminDeals(query);
      if (ticket !== latest.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Could not load the deals');
    }
  }, [query]);

  useEffect(() => { if (ready) void load(); }, [ready, load]);
  useEffect(() => { if (ready) setSearch(url.search); }, [ready, url.search]);
  useEffect(() => {
    if (!ready || search.trim() === url.search) return;
    const timer = setTimeout(() => setUrl({ search: search.trim(), page: '1' }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, search, url.search, setUrl]);

  const open = (row: AdminDealRow) => {
    const here = `${window.location.pathname}${window.location.search}`;
    router.push(`/deals/${row.id}/?${backLinkQuery(here, 'Deals')}`);
  };

  const columns: Column<AdminDealRow>[] = [
    { key: 'ref', header: 'Deal', render: (r) => <span className="font-mono font-semibold text-gray-900">{formatDealRef(r.ref)}</span> },
    {
      key: 'listing',
      header: 'Listing',
      render: (r) => (
        <span className="min-w-0">
          <span className="block max-w-[16rem] truncate font-bold text-gray-900">{r.listing.title}</span>
          <span className="block font-mono text-[13px] text-gray-500">{formatRef(r.listing.ref)}</span>
        </span>
      ),
    },
    { key: 'buyer', header: 'Buyer', render: (r) => <span className="block max-w-[11rem] truncate">{r.buyer.name}</span> },
    { key: 'seller', header: 'Seller', render: (r) => <span className="block max-w-[11rem] truncate">{r.seller.name}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge status={r.status} label={DEAL_STATUS_LABELS[r.status]} tone={DEAL_STATUS_TONES[r.status]} />
          {r.openDisputeId && r.status !== 'disputed' && <span className="text-[12px] font-bold text-amber-600">Dispute open</span>}
        </span>
      ),
    },
    {
      key: 'terms',
      header: 'Price × quantity',
      className: 'tnum',
      render: (r) => `${formatPaise(r.pricePerUnitPaise)} × ${r.quantity} ${r.unitLabel}`,
    },
    { key: 'total', header: 'Total', className: 'tnum', render: (r) => <span className="font-semibold">{formatPaiseString(r.totalPaise)}</span> },
    { key: 'acceptedAt', header: 'Agreed on', className: 'tnum', render: (r) => formatDate(r.acceptedAt) },
    { key: 'updatedAt', header: 'Updated', className: 'tnum', render: (r) => formatDate(r.updatedAt) },
  ];

  const counts = data?.counts;
  const all = counts ? DEAL_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0) : undefined;
  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: '', label: 'All', count: all },
    ...DEAL_STATUS_TABS.map((s) => ({ value: s as Tab, label: DEAL_STATUS_LABELS[s], count: counts?.[s] })),
  ];

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  const filtered = !!(url.search || url.from || url.to || url.status);

  return (
    <>
      <Tabs items={tabs} value={url.status as Tab} onChange={(v) => setUrl({ status: v, page: '1' })} />
      {error && <StaleWarning thing="list" onRetry={() => void load()} />}
      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        loading={!data}
        onRowClick={open}
        page={data?.page ?? Number(url.page)}
        pageSize={Number(url.pageSize)}
        pageSizeOptions={ADMIN_DEAL_PAGE_SIZES}
        total={data?.total}
        onPageChange={(p) => setUrl({ page: String(p) })}
        onPageSizeChange={(size) => setUrl({ pageSize: String(size), page: '1' })}
        itemLabel="deals"
        emptyMessage={filtered ? 'No deal matches' : 'No deals yet'}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search by #ref, business or listing"
              label="Search deals by reference, business name or listing title"
              maxLength={SEARCH_MAX}
            />
            <span className="flex items-center gap-2 text-sm text-gray-600">
              <label htmlFor="deals-from">Agreed from</label>
              <input
                id="deals-from"
                type="date"
                className={cn(inputCls, 'w-auto py-2')}
                value={url.from}
                onChange={(e) => setUrl({ from: e.target.value, page: '1' })}
              />
              <label htmlFor="deals-to">to</label>
              <input
                id="deals-to"
                type="date"
                className={cn(inputCls, 'w-auto py-2')}
                value={url.to}
                onChange={(e) => setUrl({ to: e.target.value, page: '1' })}
              />
            </span>
          </div>
        }
      />
    </>
  );
}
