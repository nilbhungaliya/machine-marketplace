import { beforeEach, describe, expect, it, vi } from 'vitest';

let asyncStore: Record<string, string> = {};

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncStore[k] ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      asyncStore[k] = v;
    }),
    removeItem: vi.fn(async (k: string) => {
      delete asyncStore[k];
    }),
  },
}));

import { addRecent, clearRecentSearches, loadRecentSearches, recordRecentSearch } from './recent-searches';

beforeEach(() => {
  asyncStore = {};
});

describe('recent searches (spec §8.4, R13: on the phone only)', () => {
  it('newest first, trimmed, spaces collapsed, blanks ignored', () => {
    expect(addRecent([], '  tie   rod end ')).toEqual(['tie rod end']);
    expect(addRecent(['a b'], '   ')).toEqual(['a b']);
    expect(addRecent(['old'], 'new')).toEqual(['new', 'old']);
  });

  it('a repeat moves to the top (case-insensitive), keeping the latest spelling', () => {
    expect(addRecent(['bearing', 'Gear pump', 'filter'], 'gear PUMP')).toEqual(['gear PUMP', 'bearing', 'filter']);
  });

  it('keeps 10', () => {
    let list: string[] = [];
    for (let i = 1; i <= 12; i++) list = addRecent(list, `q${i}`);
    expect(list).toHaveLength(10);
    expect(list[0]).toBe('q12');
    expect(list[9]).toBe('q3');
  });

  it('stores, reloads and clears', async () => {
    expect(await loadRecentSearches()).toEqual([]);
    await recordRecentSearch('bearing 6205');
    await recordRecentSearch('gear');
    expect(await loadRecentSearches()).toEqual(['gear', 'bearing 6205']);
    expect(Object.keys(asyncStore)).toEqual(['search.recent.v1']);
    await clearRecentSearches();
    expect(await loadRecentSearches()).toEqual([]);
  });

  it('a corrupt stored value reads as empty', async () => {
    asyncStore['search.recent.v1'] = '{nope';
    expect(await loadRecentSearches()).toEqual([]);
    asyncStore['search.recent.v1'] = JSON.stringify(['ok', 3, null, 'fine']);
    expect(await loadRecentSearches()).toEqual(['ok', 'fine']);
  });
});
