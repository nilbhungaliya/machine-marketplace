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

import { addViewed, clearRecentlyViewed, loadRecentlyViewed, recordViewed } from './recently-viewed';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  asyncStore = {};
});

describe('recently viewed (spec §8.5, R13: on the phone only)', () => {
  it('newest first, a repeat moves to the top', () => {
    expect(addViewed([], { listingId: id(1), businessId: 'b9' }, null)).toEqual([id(1)]);
    expect(addViewed([id(1), id(2)], { listingId: id(2), businessId: 'b9' }, null)).toEqual([id(2), id(1)]);
  });

  it("skips the viewer's own listings", () => {
    expect(addViewed([id(1)], { listingId: id(2), businessId: 'mine' }, 'mine')).toEqual([id(1)]);
    expect(addViewed([id(1)], { listingId: id(2), businessId: 'other' }, 'mine')).toEqual([id(2), id(1)]);
  });

  it('keeps 20', () => {
    let list: string[] = [];
    for (let i = 1; i <= 25; i++) list = addViewed(list, { listingId: id(i), businessId: 'b' }, null);
    expect(list).toHaveLength(20);
    expect(list[0]).toBe(id(25));
    expect(list[19]).toBe(id(6));
  });

  it('stores ids only, reloads and clears', async () => {
    await recordViewed({ listingId: id(1), businessId: 'b' }, null);
    await recordViewed({ listingId: id(2), businessId: 'b' }, null);
    await recordViewed({ listingId: id(3), businessId: 'me' }, 'me');
    expect(await loadRecentlyViewed()).toEqual([id(2), id(1)]);
    expect(Object.keys(asyncStore)).toEqual(['discover.recent.v1']);
    await clearRecentlyViewed();
    expect(await loadRecentlyViewed()).toEqual([]);
  });

  it('a corrupt stored value reads as empty; non-ids are dropped', async () => {
    asyncStore['discover.recent.v1'] = 'oops';
    expect(await loadRecentlyViewed()).toEqual([]);
    asyncStore['discover.recent.v1'] = JSON.stringify([id(1), 'x', 4]);
    expect(await loadRecentlyViewed()).toEqual([id(1)]);
  });
});
