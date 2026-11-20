'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DISPUTE_STATUSES, type AdminDisputeList, type AdminDisputeRow, type DisputeStatus } from '@mpm/shared-types';
import DataTable, { type Column } from '@/components/data-table';
import StatusBadge from '@/components/status-badge';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { backLinkQuery } from '@/lib/back-link';
import {
  DISPUTE_CATEGORY_LABELS, DISPUTE_OUTCOME_SHORT, DISPUTE_STATUS_LABELS, DISPUTE_STATUS_TONES, disputePartyLabels,
  disputeSubject, fetchDisputes,
} from '@/lib/disputes-api';
import { refreshNavBadges } from '@/lib/nav-badges';
import { getAdminSocket } from '@/lib/socket';
import { positiveInt, useUrlState } from '@/lib/use-url-state';
import { formatDateTime } from '@/lib/utils';

const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULTS = { status: 'open', page: '1', pageSize: '25' };
type Tab = '' | DisputeStatus;

/** How long a dispute has been open, in words: "3 h", "2 days". */
export function openFor(createdAt: string, now = Date.now()): string {
  const hours = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 3_600_000));
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * Disputes (F6 + F7 spec §9.6, §16.1; M14 R12: deal and rental booking disputes, the subject in the first column): support's queue, open first and oldest first (the API orders), then resolved,
 * newest first. A row opens the dispute. A new dispute (`dispute:new`, ids only) reloads the list.
 */
export function DisputesTable() {
  const router = useRouter();
  const [url, setUrl, ready] = useUrlState(DEFAULTS, {
    validate: { status: ['', ...DISPUTE_STATUSES], page: positiveInt, pageSize: PAGE_SIZES.map(String) },
  });
  const query = useMemo(() => ({
    status: (url.status || undefined) as DisputeStatus | undefined,
    page: Number(url.page),
    pageSize: Number(url.pageSize),
  }), [url]);
  const [data, setData] = useState<AdminDisputeList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchDisputes(query);
      if (ticket !== latest.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Could not load the disputes');
    }
  }, [query]);

  useEffect(() => { if (ready) void load(); }, [ready, load]);
  // Keep the newest `load` for the socket handler without re-subscribing on every filter change.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    const socket = getAdminSocket();
    const onNew = () => { void loadRef.current(); refreshNavBadges(); };
    socket.on('dispute:new', onNew);
    return () => { socket.off('dispute:new', onNew); };
  }, []);

  const open = (row: AdminDisputeRow) => {
    const here = `${window.location.pathname}${window.location.search}`;
    router.push(`/disputes/${row.id}/?${backLinkQuery(here, 'Disputes')}`);
  };

  const columns: Column<AdminDisputeRow>[] = [
    {
      key: 'subject',
      header: 'About',
      render: (r) => {
        const s = disputeSubject(r);
        return (
          <span className="whitespace-nowrap">
            <span className="text-[12.5px] text-gray-600">{s.kind === 'rental' ? 'Booking ' : 'Deal '}</span>
            <span className="font-mono font-semibold text-gray-900">{s.ref}</span>
          </span>
        );
      },
    },
    { key: 'category', header: 'Problem', render: (r) => <span className="font-semibold text-gray-900">{DISPUTE_CATEGORY_LABELS[r.category]}</span> },
    { key: 'by', header: 'Reported by', render: (r) => disputePartyLabels(disputeSubject(r).kind)[r.openedBySide] },
    { key: 'buyer', header: 'Buyer / renter', render: (r) => <span className="block max-w-[11rem] truncate">{r.buyer.name}</span> },
    { key: 'seller', header: 'Seller / owner', render: (r) => <span className="block max-w-[11rem] truncate">{r.seller.name}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge status={r.status} label={DISPUTE_STATUS_LABELS[r.status]} tone={DISPUTE_STATUS_TONES[r.status]} />
          {r.outcome && <span className="text-[12.5px] text-gray-600">{DISPUTE_OUTCOME_SHORT[r.outcome]}</span>}
        </span>
      ),
    },
    { key: 'createdAt', header: 'Reported', className: 'tnum', render: (r) => formatDateTime(r.createdAt) },
    {
      key: 'age',
      header: 'Open for',
      className: 'tnum',
      render: (r) => (r.status === 'open' ? openFor(r.createdAt) : r.resolvedAt ? `Resolved ${formatDateTime(r.resolvedAt)}` : '—'),
    },
  ];

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'open', label: 'Open' },
    { value: 'resolved', label: 'Resolved' },
    { value: '', label: 'All' },
  ];

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;

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
        pageSizeOptions={PAGE_SIZES}
        total={data?.total}
        onPageChange={(p) => setUrl({ page: String(p) })}
        onPageSizeChange={(size) => setUrl({ pageSize: String(size), page: '1' })}
        itemLabel="disputes"
        emptyMessage={url.status === 'open' ? 'No open disputes' : 'No disputes'}
      />
    </>
  );
}
