'use client';

import { useCallback, useState } from 'react';

const KEY_PREFIX = 'mpm.admin.rows.';

export const PAGE_SIZE_OPTIONS = [10, 20, 50];

function read(table: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = Number(window.localStorage.getItem(KEY_PREFIX + table));
    return PAGE_SIZE_OPTIONS.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Rows-per-page for one table, keyed per table so a choice on Customers does
 * not follow the manager to Jobs.
 */
export function useTablePageSize(
  table: string,
  fallback = 20,
): [number, (size: number) => void] {
  const [size, setSize] = useState(() => read(table, fallback));

  const update = useCallback(
    (next: number) => {
      setSize(next);
      try {
        window.localStorage.setItem(KEY_PREFIX + table, String(next));
      } catch {
        // private browsing — the choice just won't outlive the tab
      }
    },
    [table],
  );

  return [size, update];
}
