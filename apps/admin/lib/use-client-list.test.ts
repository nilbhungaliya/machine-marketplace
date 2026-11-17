// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { applyClientList, formatSort, parseSort, sortParamValidator, useClientList, useResetPage } from './use-client-list';

type Row = { id: number; name: string; city: string | null; active: boolean; score: number };
const rows: Row[] = [
  { id: 1, name: 'Ravi Patel', city: 'Surat', active: true, score: 2 },
  { id: 2, name: 'Asha Shah', city: null, active: false, score: 1 },
  { id: 3, name: 'Kiran Mehta', city: 'Rajkot', active: true, score: 2 },
  { id: 4, name: 'Dev Joshi', city: 'surat', active: true, score: 3 },
  { id: 5, name: 'Mira Desai', city: 'Vadodara', active: false, score: 2 },
];
const ids = (r: Row[]) => r.map((x) => x.id);
const fields = [(r: Row) => r.name, (r: Row) => r.city];
const sorters = {
  score: (a: Row, b: Row) => a.score - b.score,
  name: (a: Row, b: Row) => a.name.localeCompare(b.name),
};

describe('applyClientList', () => {
  it('null rows give an empty result', () => {
    expect(applyClientList<Row>(null, {})).toEqual({ visible: [], total: 0, matching: 0, pageCount: 1, page: 1 });
  });

  it('no options returns every row in the given order', () => {
    const r = applyClientList(rows, {});
    expect(ids(r.visible)).toEqual([1, 2, 3, 4, 5]);
    expect(r.total).toBe(5);
    expect(r.matching).toBe(5);
  });

  it('search is case-insensitive, trimmed, across fields, ignoring nulls', () => {
    const r = applyClientList(rows, { search: { text: '  SURAT ', fields } });
    expect(ids(r.visible)).toEqual([1, 4]);
    expect(r.matching).toBe(2);
    expect(r.total).toBe(5);
  });

  it('blank search matches everything', () => {
    expect(applyClientList(rows, { search: { text: '   ', fields } }).matching).toBe(5);
  });

  it('filters AND together, and with search', () => {
    const r = applyClientList(rows, {
      search: { text: 'a', fields },
      filters: [(x) => x.active, (x) => x.score === 2],
    });
    expect(ids(r.visible)).toEqual([1, 3]);
    expect(r.matching).toBe(2);
  });

  it('sort uses the named sorter and keeps ties in the original order', () => {
    expect(ids(applyClientList(rows, { sort: { key: 'score', dir: 'asc' }, sorters }).visible)).toEqual([2, 1, 3, 5, 4]);
  });

  it('desc reverses the sorter but still keeps ties in the original order', () => {
    expect(ids(applyClientList(rows, { sort: { key: 'score', dir: 'desc' }, sorters }).visible)).toEqual([4, 1, 3, 5, 2]);
  });

  it('no sort, or an unknown sort key, keeps the original order', () => {
    expect(ids(applyClientList(rows, { sort: null, sorters }).visible)).toEqual([1, 2, 3, 4, 5]);
    expect(ids(applyClientList(rows, { sort: { key: 'nope', dir: 'asc' }, sorters }).visible)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not mutate the input array', () => {
    const copy = [...rows];
    applyClientList(rows, { sort: { key: 'name', dir: 'asc' }, sorters });
    expect(rows).toEqual(copy);
  });

  it('pages after filtering and sorting', () => {
    const r = applyClientList(rows, {
      filters: [(x) => x.id !== 2],
      sort: { key: 'name', dir: 'asc' },
      sorters,
      pageSize: 2,
      page: 2,
    });
    // Sorted names without id 2: Dev(4) Kiran(3) Mira(5) Ravi(1)
    expect(ids(r.visible)).toEqual([5, 1]);
    expect(r.matching).toBe(4);
    expect(r.pageCount).toBe(2);
    expect(r.page).toBe(2);
  });

  it('clamps a page past the end to the last page (filter applied while on the last page)', () => {
    const r = applyClientList(rows, { filters: [(x) => x.active], pageSize: 2, page: 3 });
    expect(r.pageCount).toBe(2);
    expect(r.page).toBe(2);
    expect(ids(r.visible)).toEqual([4]);
  });

  it('clamps a page below 1 and an empty result to page 1 of 1', () => {
    expect(applyClientList(rows, { pageSize: 2, page: 0 }).page).toBe(1);
    const empty = applyClientList(rows, { search: { text: 'zzz', fields }, pageSize: 2, page: 4 });
    expect(empty).toMatchObject({ visible: [], matching: 0, pageCount: 1, page: 1 });
  });

  it('without pageSize there is one page holding everything', () => {
    const r = applyClientList(rows, { page: 3 });
    expect(r.pageCount).toBe(1);
    expect(r.page).toBe(1);
    expect(r.visible).toHaveLength(5);
  });
});

describe('sort param helpers', () => {
  it('formats and parses <column>:<dir>', () => {
    expect(formatSort({ key: 'name', dir: 'desc' })).toBe('name:desc');
    expect(formatSort(null)).toBe('');
    expect(parseSort('name:asc')).toEqual({ key: 'name', dir: 'asc' });
    expect(parseSort('')).toBeNull();
    expect(parseSort('name:up')).toBeNull();
    expect(parseSort('name')).toBeNull();
  });

  it('parseSort rejects columns outside the allowed list', () => {
    expect(parseSort('city:asc', ['name'])).toBeNull();
    expect(parseSort('name:asc', ['name'])).toEqual({ key: 'name', dir: 'asc' });
  });

  it('sortParamValidator accepts allowed sorts and the empty default', () => {
    const ok = sortParamValidator(['name', 'score']);
    expect(ok('name:desc')).toBe(true);
    expect(ok('')).toBe(true);
    expect(ok('city:asc')).toBe(false);
    expect(ok('name:sideways')).toBe(false);
  });
});

afterEach(cleanup);

describe('useClientList', () => {
  it('returns the same result as applyClientList and follows prop changes', () => {
    const { result, rerender } = renderHook(
      ({ text }) => useClientList(rows, { search: { text, fields }, pageSize: 10, page: 1 }),
      { initialProps: { text: '' } },
    );
    expect(result.current.matching).toBe(5);
    rerender({ text: 'surat' });
    expect(ids(result.current.visible)).toEqual([1, 4]);
  });
});

describe('useResetPage', () => {
  it('does not reset on mount, resets when any watched value changes', () => {
    const calls: number[] = [];
    const setPage = (p: number) => calls.push(p);
    const { rerender } = renderHook(({ q, s }) => useResetPage(setPage, [q, s]), {
      initialProps: { q: '', s: 'all' },
    });
    expect(calls).toEqual([]);
    rerender({ q: '', s: 'all' });
    expect(calls).toEqual([]);
    rerender({ q: 'ravi', s: 'all' });
    expect(calls).toEqual([1]);
    rerender({ q: 'ravi', s: 'yes' });
    expect(calls).toEqual([1, 1]);
  });
});

describe('useResetPage enabled flag', () => {
  it('values that arrive with enabled turning on (URL read) do not reset; later changes do', () => {
    const calls: number[] = [];
    const setPage = (p: number) => calls.push(p);
    const { rerender } = renderHook(({ q, ready }) => useResetPage(setPage, [q], ready), {
      initialProps: { q: '', ready: false },
    });
    rerender({ q: 'from-url', ready: true });
    expect(calls).toEqual([]);
    rerender({ q: 'typed', ready: true });
    expect(calls).toEqual([1]);
  });
});
