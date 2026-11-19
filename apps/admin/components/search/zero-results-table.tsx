'use client';

import { Replace } from 'lucide-react';
import type { ZeroResultRow } from '@mpm/shared-types';
import DataTable, { type Column } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { formatDay } from '@/lib/search-api';

/**
 * Searches that found nothing (F4 + F5 spec §5.13, §9): top 50 of the last 30 days, as search stored them (normalised).
 * "Make a synonym" opens the add dialog with the search as the term.
 */
export function ZeroResultsTable({ rows, onMakeSynonym }: {
  rows: ZeroResultRow[];
  onMakeSynonym: (term: string) => void;
}) {
  const columns: Column<ZeroResultRow & { id: string }>[] = [
    { key: 'normalized', header: 'Search', render: (r) => <span className="font-bold text-gray-900">{r.normalized}</span> },
    { key: 'searches', header: 'Searches', className: 'tnum text-right', render: (r) => r.searches },
    { key: 'lastDay', header: 'Last searched', className: 'tnum', render: (r) => formatDay(r.lastDay) },
    {
      key: 'actions',
      header: '',
      className: 'w-1 text-right',
      render: (r) => (
        <Button variant="ghost" size="sm" aria-label={`Make a synonym of ${r.normalized}`} onClick={() => onMakeSynonym(r.normalized)}>
          <Replace size={13} aria-hidden /> Make a synonym
        </Button>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows.map((r) => ({ ...r, id: r.normalized }))}
      emptyMessage="Every search in the last 30 days found something"
    />
  );
}
