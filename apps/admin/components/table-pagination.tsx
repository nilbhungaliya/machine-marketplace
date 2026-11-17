'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZE_OPTIONS } from '@/lib/use-table-page-size';

interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** Plural noun for the count line, e.g. "customers". */
  itemLabel?: string;
}

/** Widest the number strip is allowed to get, so the bar never wraps. */
const WINDOW = 7;

/** 1 … 8 9 10 … 18 — always WINDOW slots or fewer. */
function pageSlots(page: number, pages: number): (number | 'gap')[] {
  if (pages <= WINDOW) {
    return Array.from({ length: pages }, (_, i) => i + 1);
  }

  let start = Math.max(2, page - 1);
  let end = Math.min(pages - 1, page + 1);
  // Pin the run near each end so the strip keeps a constant width there.
  if (page <= 3) { start = 2; end = 4; }
  if (page >= pages - 2) { start = pages - 3; end = pages - 1; }

  const slots: (number | 'gap')[] = [1];
  if (start > 2) slots.push('gap');
  for (let p = start; p <= end; p++) slots.push(p);
  if (end < pages - 1) slots.push('gap');
  slots.push(pages);
  return slots;
}

const BTN =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-gray-200 px-2 text-sm tabular-nums text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-40';

export default function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  itemLabel = 'records',
}: TablePaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  const go = (p: number) => {
    if (p >= 1 && p <= pages && p !== page) onPageChange(p);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
      <p className="text-sm tabular-nums text-gray-500">
        {total === 0 ? (
          `No ${itemLabel}`
        ) : (
          <>
            <span className="font-semibold text-gray-900">
              {from}&ndash;{to}
            </span>{' '}
            of {total} {itemLabel}
          </>
        )}
      </p>

      <div className="flex items-center gap-4">
        {onPageSizeChange && (
          <label className="flex items-center gap-2 text-sm text-gray-500">
            Rows
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 rounded-lg border border-gray-200 bg-white py-0 pl-2 text-sm text-gray-600 focus:border-brand-400 focus:ring-1 focus:ring-brand-400"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        {pages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Previous page"
              onClick={() => go(current - 1)}
              disabled={current <= 1}
              className={BTN}
            >
              <ChevronLeft size={16} />
            </button>

            {pageSlots(current, pages).map((slot, i) =>
              slot === 'gap' ? (
                <span key={`gap-${i}`} className="w-5 select-none text-center text-sm text-gray-400">
                  &hellip;
                </span>
              ) : (
                <button
                  key={slot}
                  type="button"
                  onClick={() => go(slot)}
                  aria-current={slot === current ? 'page' : undefined}
                  className={
                    slot === current
                      ? `${BTN} border-brand-500 bg-brand-500 font-semibold text-white hover:bg-brand-600 hover:text-white`
                      : BTN
                  }
                >
                  {slot}
                </button>
              ),
            )}

            <button
              type="button"
              aria-label="Next page"
              onClick={() => go(current + 1)}
              disabled={current >= pages}
              className={BTN}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
