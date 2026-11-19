import { describe, expect, it } from 'vitest';
import type { Suggestion } from '@mpm/shared-types';
import { browseBackTarget, browseCrumbs, browseRowOpens, startState, suggestionRow, suggestionTarget } from './search-start';

const sug = (s: Partial<Suggestion> & Pick<Suggestion, 'type'>): Suggestion => ({ id: 'x', name: 'n', path: [], liveCount: 3, ...s });

describe('startState (Search tab params)', () => {
  it('browseNodeId opens Browse at that node; focus opens the search box focused; none → the root', () => {
    expect(startState({ browseNodeId: 'c1' })).toEqual({ browseNodeId: 'c1', focus: false });
    expect(startState({ focus: true })).toEqual({ browseNodeId: null, focus: true });
    expect(startState(undefined)).toEqual({ browseNodeId: null, focus: false });
  });
});

describe('browseCrumbs', () => {
  it('the root crumb first; the node on screen is the current one', () => {
    expect(browseCrumbs({ crumbs: [] })).toEqual([{ id: null, name: null, current: true }]);
    expect(browseCrumbs({ crumbs: [{ id: 'a', name: 'Earthmoving' }, { id: 'b', name: 'Backhoe loaders' }] })).toEqual([
      { id: null, name: null, current: false },
      { id: 'a', name: 'Earthmoving', current: false },
      { id: 'b', name: 'Backhoe loaders', current: true },
    ]);
  });

  it('a part group opens its results; other levels drill down', () => {
    expect(browseRowOpens({ level: 'part_group' })).toBe('results');
    expect(browseRowOpens({ level: 'machine_type' })).toBe('drill');
  });
});

describe('browseBackTarget (Android Back in Browse)', () => {
  const view = {
    crumbs: [{ id: 'a', name: 'Earthmoving' }, { id: 'b', name: 'Backhoe loaders' }],
    children: [{ id: 'c' }],
  } as unknown as Parameters<typeof browseBackTarget>[1];
  it("goes to the node's parent when the view is loaded or the node is up the crumbs", () => {
    expect(browseBackTarget('b', view)).toBe('a');
    expect(browseBackTarget('a', view)).toBeNull();
  });
  it('goes to the last loaded node while a drilled row is still loading', () => {
    expect(browseBackTarget('c', view)).toBe('b');
  });
  it('goes to the root when nothing loaded knows the node', () => {
    expect(browseBackTarget('x', view)).toBeNull();
    expect(browseBackTarget('x', null)).toBeNull();
  });
});

describe('suggestions', () => {
  it('rows: a category with its path, a model with its brand, a listing with its ref', () => {
    expect(suggestionRow(sug({ type: 'category', name: 'Hydraulics', path: ['Earthmoving', 'Backhoe loaders'] })))
      .toMatchObject({ title: 'Hydraulics', subtitle: 'Earthmoving › Backhoe loaders', typeKey: 'discover.search.suggest.category' });
    expect(suggestionRow(sug({ type: 'model', name: '3DX', path: ['JCB'] })).subtitle).toBe('JCB');
    expect(suggestionRow(sug({ type: 'listing', id: 'l1', name: 'Gear pump', ref: 100123 })))
      .toMatchObject({ ref: 100123, typeKey: 'discover.search.suggest.listing', subtitle: null });
  });

  it('targets: listing page, category / brand as filters, a model as "<brand> <model>" words', () => {
    expect(suggestionTarget(sug({ type: 'listing', id: 'l1' }))).toEqual({ screen: 'Listing', listingId: 'l1' });
    expect(suggestionTarget(sug({ type: 'category', id: 'c1' }))).toEqual({ screen: 'SearchResults', request: { filters: { categoryId: 'c1' } } });
    expect(suggestionTarget(sug({ type: 'brand', id: 'b1' }))).toEqual({ screen: 'SearchResults', request: { filters: { brandId: 'b1' } } });
    expect(suggestionTarget(sug({ type: 'model', name: '3DX', path: ['JCB'] }))).toEqual({ screen: 'SearchResults', request: { q: 'JCB 3DX' } });
  });
});
