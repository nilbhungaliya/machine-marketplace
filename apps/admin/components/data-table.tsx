'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import TablePagination from '@/components/table-pagination';
import { EmptyState, TableSkeleton } from '@/components/ui/states';
import type { SortState } from '@/lib/use-client-list';

export type { SortState };

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  /** Header becomes a sort button — only when the owner can sort by it and passes onSortChange. */
  sortable?: boolean;
  /** Tooltip on the header cell (its title attribute). */
  headerTitle?: string;
}

/** asc → desc → none on the same column; another column starts at asc. */
function nextSort(current: SortState | null | undefined, key: string): SortState | null {
  if (current?.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  /** Per-row classes, for tinting rows that need to stand out. */
  rowClassName?: (row: T) => string;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** Rows-per-page choices; the shared PAGE_SIZE_OPTIONS when absent. */
  pageSizeOptions?: readonly number[];
  /** Plural noun for the pagination count line, e.g. "customers". */
  itemLabel?: string;
  emptyMessage?: string;
  loading?: boolean;
  /**
   * The sort to show. The table never reorders rows itself: the owner sorts
   * (useClientList, or a server sort param) and passes rows in order.
   */
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;
  /** Above the table, inside the same card: search box, chips, count. */
  toolbar?: ReactNode;
}

export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  rowClassName,
  page = 1,
  pageSize = 20,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions,
  itemLabel,
  emptyMessage = 'Nothing here yet',
  loading,
  sort,
  onSortChange,
  toolbar,
}: DataTableProps<T>) {
  // One Tab stop for the rows (the last one focused); arrow keys reach the rest.
  const [activeRow, setActiveRow] = useState(0);
  const stop = Math.min(activeRow, Math.max(0, data.length - 1));
  const body = useRef<HTMLTableSectionElement>(null);
  // Name each row after its first cell, so a screen reader says what Enter opens.
  useLayoutEffect(() => {
    if (!onRowClick) return;
    body.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row-link]').forEach((tr) => {
      const text = (tr.cells[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
      tr.setAttribute('aria-label', text ? `Open ${text}` : 'Open');
    });
  });
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    // Only on the row itself; preventDefault keeps an enclosing dialog's Enter rule out.
    if ((e.key !== 'Enter' && e.key !== ' ') || e.target !== e.currentTarget || e.repeat || e.nativeEvent.isComposing
      || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    onRowClick?.(row);
  };

  const toolbarRow = toolbar ? <div className="border-b border-gray-200 px-4 py-3">{toolbar}</div> : null;

  if (loading) {
    return (
      <div className="rounded-[20px] border border-gray-200 bg-white">
        {toolbarRow}
        <TableSkeleton rows={5} cols={Math.min(columns.length, 6)} />
      </div>
    );
  }

  return (
    <div className="rounded-[20px] border border-gray-200 bg-white overflow-hidden">
      {toolbarRow}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => {
                const canSort = col.sortable && onSortChange;
                const dir = sort?.key === col.key ? sort.dir : null;
                const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown;
                return (
                  <th
                    key={col.key}
                    title={col.headerTitle}
                    aria-sort={canSort ? (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') : undefined}
                    className={`px-4 py-3 text-left text-xs font-bold text-gray-600 ${col.className || ''}`}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(nextSort(sort, col.key))}
                        className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                      >
                        {col.header}
                        <Icon size={12} aria-hidden className={dir ? 'text-gray-700' : 'text-gray-300'} />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={body} className="divide-y divide-gray-100">
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyMessage ?? 'Nothing here yet'} />
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr
                  key={row.id || idx}
                  onClick={() => onRowClick?.(row)}
                  // Keyboard: arrows reach the row, Enter or Space opens it.
                  tabIndex={onRowClick ? (idx === stop ? 0 : -1) : undefined}
                  data-row-link={onRowClick ? '' : undefined}
                  onFocus={onRowClick ? (e) => { if (e.target === e.currentTarget) setActiveRow(idx); } : undefined}
                  onKeyDown={onRowClick ? (e) => onRowKey(e, row) : undefined}
                  className={`${onRowClick ? 'cursor-pointer hover:bg-brand-50/60' : ''} ${rowClassName?.(row) || ''} transition-colors`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap px-4 py-3 text-sm text-gray-700 ${col.className || ''}`}
                    >
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {onPageChange && total !== undefined && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          pageSizeOptions={pageSizeOptions}
          itemLabel={itemLabel}
        />
      )}
    </div>
  );
}
