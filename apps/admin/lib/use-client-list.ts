import { useEffect, useMemo, useRef } from 'react';

export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDir;
}

export interface ClientListOptions<T> {
  /** Case-insensitive, trimmed substring match; a row matches if any field does. Null fields are skipped. */
  search?: { text: string; fields: Array<(row: T) => string | null | undefined> };
  /** Every filter must pass (AND). */
  filters?: Array<(row: T) => boolean>;
  /** null, or a key with no sorter, keeps the rows' original order. */
  sort?: SortState | null;
  sorters?: Record<string, (a: T, b: T) => number>;
  /** Omit for no paging. */
  pageSize?: number;
  /** 1-based; clamped to [1, pageCount]. */
  page?: number;
}

export interface ClientListResult<T> {
  visible: T[];
  /** All rows given, before search and filters. */
  total: number;
  /** Rows left after search and filters (what pagination counts). */
  matching: number;
  pageCount: number;
  /** The page actually shown, after clamping. Pass this to the table, not the requested one. */
  page: number;
}

/**
 * Search → filters → sort → page, in memory. Only for lists the page holds
 * completely: sorting or paging a server page here would sort one page only.
 */
export function applyClientList<T>(rows: T[] | null, opts: ClientListOptions<T>): ClientListResult<T> {
  if (!rows) return { visible: [], total: 0, matching: 0, pageCount: 1, page: 1 };

  let out = rows;
  const needle = opts.search?.text.trim().toLowerCase() ?? '';
  if (needle && opts.search) {
    const fields = opts.search.fields;
    out = out.filter((row) => fields.some((f) => f(row)?.toLowerCase().includes(needle)));
  }
  const filters = opts.filters;
  if (filters && filters.length > 0) {
    out = out.filter((row) => filters.every((f) => f(row)));
  }

  const sorter = opts.sort ? opts.sorters?.[opts.sort.key] : undefined;
  if (opts.sort && sorter) {
    const sign = opts.sort.dir === 'desc' ? -1 : 1;
    // Decorated with the index so ties keep the original order in both directions.
    out = out
      .map((row, i) => ({ row, i }))
      .sort((a, b) => sign * sorter(a.row, b.row) || a.i - b.i)
      .map((x) => x.row);
  }

  const matching = out.length;
  if (!opts.pageSize) return { visible: out, total: rows.length, matching, pageCount: 1, page: 1 };

  const pageCount = Math.max(1, Math.ceil(matching / opts.pageSize));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1)), pageCount);
  const start = (page - 1) * opts.pageSize;
  return { visible: out.slice(start, start + opts.pageSize), total: rows.length, matching, pageCount, page };
}

/**
 * applyClientList, memoised. The caller owns `page` and must set it back to 1
 * whenever search, a filter, the sort or the page size changes — useResetPage
 * does that. A page past the end (rows removed, a refresh returns fewer) is
 * clamped in the result; render `result.page`.
 */
export function useClientList<T>(rows: T[] | null, opts: ClientListOptions<T>): ClientListResult<T> {
  const { search, filters, sort, sorters, pageSize, page } = opts;
  const text = search?.text;
  const fields = search?.fields;
  const sortKey = sort?.key;
  const sortDir = sort?.dir;
  return useMemo(
    () =>
      applyClientList(rows, {
        search: fields && text !== undefined ? { text, fields } : undefined,
        filters,
        sort: sortKey && sortDir ? { key: sortKey, dir: sortDir } : null,
        sorters,
        pageSize,
        page,
      }),
    [rows, text, fields, filters, sortKey, sortDir, sorters, pageSize, page],
  );
}

/**
 * Calls setPage(1) when any of `watch` changes — not on mount, so a page read
 * from the URL survives the first render. Values are compared by JSON.
 *
 * Pass useUrlState's `ready` as `enabled`: while false, and on the render it
 * turns true (the URL values arriving), the values are recorded without a reset.
 *
 * A Back/Forward landing (popstate re-read) with a different filter also counts
 * as a change and resets the page. Rare: these lists only use replaceState.
 */
export function useResetPage(
  setPage: (page: number) => void,
  watch: readonly unknown[],
  enabled = true,
): void {
  const sig = JSON.stringify(watch);
  const last = useRef(sig);
  const wasEnabled = useRef(enabled);
  useEffect(() => {
    const armed = enabled && wasEnabled.current;
    wasEnabled.current = enabled;
    if (last.current === sig) return;
    last.current = sig;
    if (armed) setPage(1);
  }, [sig, setPage, enabled]);
}

/** `<column>:<asc|desc>`, or '' for no sort — the `sort` URL param. */
export function formatSort(sort: SortState | null | undefined): string {
  return sort ? `${sort.key}:${sort.dir}` : '';
}

export function parseSort(value: string, allowed?: readonly string[]): SortState | null {
  const m = /^([^:]+):(asc|desc)$/.exec(value);
  if (!m) return null;
  if (allowed && !allowed.includes(m[1])) return null;
  return { key: m[1], dir: m[2] as SortDir };
}

/** Validator for useUrlState: '' or an allowed `<column>:<dir>`. */
export function sortParamValidator(allowed: readonly string[]): (value: string) => boolean {
  return (value) => value === '' || parseSort(value, allowed) !== null;
}
