import { describe, expect, it } from 'vitest';
import type { HomeView, ListingCard } from '@mpm/shared-types';
import { homeEmpty, homeTiles, seeAllTarget, tileTarget } from './home-view';

const card = { id: 'l1' } as ListingCard;

describe('home tiles (spec §8.3, R15)', () => {
  it('puts the three kind tiles first in a fixed order, then the roots in admin order', () => {
    const tiles = homeTiles({
      // The server's order of kind tiles doesn't matter.
      kindTiles: [{ kind: 'machine_rental', count: 2 }, { kind: 'part', count: 9 }],
      rootCategories: [{ id: 'c2', name: 'Textile', icon: 'shirt' }, { id: 'c1', name: 'Earthmoving', icon: null }],
    });
    expect(tiles).toEqual([
      { type: 'kind', kind: 'part', count: 9 },
      { type: 'kind', kind: 'machine', count: null },
      { type: 'kind', kind: 'machine_rental', count: 2 },
      { type: 'category', id: 'c2', name: 'Textile', icon: 'shirt' },
      { type: 'category', id: 'c1', name: 'Earthmoving', icon: null },
    ]);
    // Before the first answer the kind tiles are already there.
    expect(homeTiles(undefined).map((t) => t.type)).toEqual(['kind', 'kind', 'kind']);
  });

  it('a kind tile opens results with that kind; a category tile opens Browse at that node', () => {
    expect(tileTarget({ type: 'kind', kind: 'machine_rental', count: 1 })).toEqual({ screen: 'SearchResults', params: { filters: { kinds: ['machine_rental'] } } });
    expect(tileTarget({ type: 'category', id: 'c1', name: 'x', icon: null }))
      .toEqual({ screen: 'Main', params: { screen: 'Search', params: { browseNodeId: 'c1' } } });
    expect(seeAllTarget()).toEqual({ screen: 'SearchResults', params: { filters: { kinds: ['part', 'machine'] } } });
  });
});

describe('home empty state (spec §8.3)', () => {
  const view = (radiusKm: HomeView['radiusKm'], top: ListingCard[] = [], rent: ListingCard[] = []) => ({ radiusKm, topNearYou: top, rentNearby: rent });

  it('is not empty while either section has cards', () => {
    expect(homeEmpty(view(50, [card]))).toBeNull();
    expect(homeEmpty(view(50, [], [card]))).toBeNull();
  });

  it('names the radius the server applied and widens one step, up to All India', () => {
    expect(homeEmpty(view(50))).toEqual({ kind: 'radius', km: 50, widenTo: 100 });
    expect(homeEmpty(view(10))).toEqual({ kind: 'radius', km: 10, widenTo: 25 });
    expect(homeEmpty(view(200))).toEqual({ kind: 'radius', km: 200, widenTo: null });
  });

  it('All India (or no origin) has no radius to widen', () => {
    expect(homeEmpty(view(null))).toEqual({ kind: 'none' });
  });
});
