'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import type { TrendingRow } from '@mpm/shared-types';
import { Tag } from '@/components/catalog/active-switch';
import DataTable, { type Column } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { explainSearchError, hideTrending, unhideTrending } from '@/lib/search-api';
import { cn } from '@/lib/utils';

/**
 * Trending searches (F4 + F5 spec §5.12, §9): top 20 of the last 7 days with their counts and distinct days. The app's
 * trending list shows those searched on 3+ days and 5+ times; Hide keeps one out of it (audit-logged), Unhide brings it
 * back.
 */
export function TrendingTable({ rows, onChanged }: {
  rows: TrendingRow[];
  /** Reloads the list after Hide / Unhide. */
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (row: TrendingRow) => {
    setBusy(row.normalized);
    try {
      if (row.hidden) {
        await unhideTrending(row.normalized);
        toast.success('Shown in trending again');
      } else {
        await hideTrending(row.normalized);
        toast.success('Hidden from trending in the app');
      }
      await onChanged();
    } catch (err) {
      toast.error(explainSearchError(err, 'Could not save'));
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<TrendingRow & { id: string }>[] = [
    {
      key: 'normalized',
      header: 'Search',
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className={cn('font-bold text-gray-900', r.hidden && 'text-gray-500')}>{r.normalized}</span>
          {r.hidden && <Tag>Hidden</Tag>}
        </span>
      ),
    },
    { key: 'searches', header: 'Searches', className: 'tnum text-right', render: (r) => r.searches },
    { key: 'days', header: 'Days searched', className: 'tnum text-right', headerTitle: 'Distinct days in the last 7', render: (r) => r.days },
    {
      key: 'actions',
      header: '',
      className: 'w-1 text-right',
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${r.hidden ? 'Unhide' : 'Hide'} ${r.normalized}`}
          loading={busy === r.normalized}
          disabled={busy !== null}
          onClick={() => void toggle(r)}
        >
          {busy !== r.normalized && (r.hidden ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />)}
          {r.hidden ? 'Unhide' : 'Hide'}
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows.map((r) => ({ ...r, id: r.normalized }))}
      rowClassName={(r) => (r.hidden ? 'bg-gray-50' : '')}
      emptyMessage="Nothing trending in the last 7 days"
    />
  );
}
