import { describe, expect, it } from 'vitest';
import { SEARCH_SORTS, type QueryReading } from '@mpm/shared-types';
import { resources } from '@/locales';
import {
  bannerCopy, clearAllFilters, clearFilter, footerCopy, noResultsCopy, readingChips, removeReadingChip, sortOptions,
  submittedProps, withFilters, withQuery, withRentalDates, type ResultsRequest,
} from './search-request';

type Tree = { [k: string]: string | Tree };
const flatten = (t: Tree, prefix = ''): string[] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)));
const keysOf = (lang: 'en' | 'hi' | 'gu') => new Set(flatten(resources[lang].translation as unknown as Tree));
const has = (keys: Set<string>, key: string) => keys.has(key) || (keys.has(`${key}_one`) && keys.has(`${key}_other`));

const reading = (r: Partial<QueryReading>): QueryReading => ({
  ref: null, brand: null, model: null, category: null, partNumbers: [], side: null, words: [], wordGroups: [], ...r,
});

describe('removeReadingChip (§5.3, R8)', () => {
  it('a chip read from the words goes into removedChips; the words stay', () => {
    const req: ResultsRequest = { q: 'tie rod end tata 1613 rh', sort: 'newest' };
    expect(removeReadingChip(req, 'side')).toEqual({ q: 'tie rod end tata 1613 rh', removedChips: ['side'], sort: 'newest' });
    expect(removeReadingChip({ ...req, removedChips: ['side'] }, 'brand').removedChips).toEqual(['side', 'brand']);
  });

  it('a chip set as a filter (suggestion, Browse, Filters) clears that filter', () => {
    expect(removeReadingChip({ filters: { brandId: 'b1', kinds: ['part'] } }, 'brand'))
      .toEqual({ filters: { kinds: ['part'] } });
    expect(removeReadingChip({ filters: { side: 'left' } }, 'side')).toEqual({});
  });

  it('with words, a filter chip is both cleared and listed (the reader would bring it back otherwise)', () => {
    expect(removeReadingChip({ q: 'jcb pump', filters: { brandId: 'b1' } }, 'brand'))
      .toEqual({ q: 'jcb pump', removedChips: ['brand'] });
  });

  it('removing the category takes its spec filters with it (FILTER_NOT_AVAILABLE otherwise)', () => {
    expect(removeReadingChip({ filters: { categoryId: 'c1', specs: { bore: ['63'] }, minQty: 10 } }, 'category'))
      .toEqual({ filters: { minQty: 10 } });
  });
});

describe('readingChips', () => {
  it('chips for category, brand, model, part numbers and side; word synonyms stay words', () => {
    const chips = readingChips(reading({
      brand: { id: 'b', name: 'JCB' },
      model: { id: 'm', name: '3DX', brandId: 'b' },
      partNumbers: ['ab123x', '4r1040'],
      side: 'right',
      words: ['pump'],
      wordGroups: [{ typed: ['fender'], alternatives: [['mudguard']] }],
    }));
    expect(chips.map((c) => c.id)).toEqual(['brand', 'model', 'partNumber', 'side']);
    expect(chips[2].text).toBe('AB123X, 4R1040');
    expect(chips[3].copy).toEqual({ key: 'discover.chips.side.right' });
  });
});

describe('request reset rules', () => {
  it('new words start a new list: removed chips and sort reset, filters stay', () => {
    expect(withQuery({ q: 'a', filters: { kinds: ['part'] }, removedChips: ['side'], sort: 'price_asc' }, '  gear pump '))
      .toEqual({ q: 'gear pump', filters: { kinds: ['part'] } });
  });

  it('a machine-only sort is dropped when the kinds stop being machines only', () => {
    const req: ResultsRequest = { filters: { kinds: ['machine'] }, sort: 'year_desc' };
    expect(clearFilter(req, 'kinds')).toEqual({});
    expect(withFilters(req, { kinds: ['machine', 'part'] }).sort).toBeUndefined();
    expect(withFilters(req, { kinds: ['machine_rental'] }).sort).toBe('year_desc');
  });

  it('Clear all keeps where the search came from (kinds, category, brand) and the distance', () => {
    expect(clearAllFilters({
      kinds: ['part'], categoryId: 'c', brandId: 'b', radiusKm: null, side: 'left', minQty: 2, fit: { brandId: 'x' },
      specs: { bore: ['63'] },
    })).toEqual({ brandId: 'b', categoryId: 'c', kinds: ['part'], radiusKm: null });
  });
});

describe('sortOptions (§5.8)', () => {
  it('nearest needs a location; year and hours need machine kinds only', () => {
    expect(sortOptions({ kinds: [], hasOrigin: false })).toEqual(['best_match', 'newest', 'price_asc', 'price_desc']);
    expect(sortOptions({ kinds: ['machine', 'machine_rental'], hasOrigin: true })).toEqual([...SEARCH_SORTS]);
    expect(sortOptions({ kinds: ['machine', 'part'], hasOrigin: true })).not.toContain('year_desc');
  });
});

describe('copy', () => {
  it('footer (§5.11): Show n · close ones when only partials · No results disabled', () => {
    expect(footerCopy({ total: 14, partialTotal: null })).toEqual({ key: 'discover.search.filters.show', params: { count: 14 }, disabled: false });
    expect(footerCopy({ total: 0, partialTotal: 6 })).toEqual({ key: 'discover.search.filters.showClose', params: { count: 6 }, disabled: false });
    expect(footerCopy({ total: 0, partialTotal: null }).disabled).toBe(true);
    expect(footerCopy({ total: 0, partialTotal: 0 }).key).toBe('discover.search.filters.noResults');
  });

  it('banner (§5.6): the widen sentence only when widen is set; no radius without an origin', () => {
    expect(bannerCopy({ partial: false, widen: null }, 50, true)).toEqual([]);
    expect(bannerCopy({ partial: true, widen: { radiusKm: 100, count: 3 } }, 50, true)).toEqual([
      { key: 'discover.search.partial.noneWithin', params: { km: 50 } },
      { key: 'discover.search.partial.exactWithin', params: { count: 3, km: 100 } },
    ]);
    expect(bannerCopy({ partial: true, widen: { radiusKm: null, count: 2 } }, 200, false)).toEqual([
      { key: 'discover.search.partial.none' },
      { key: 'discover.search.partial.exactAllIndia', params: { count: 2 } },
    ]);
  });

  it('every copy key exists in en, hi and gu', () => {
    const keys = [
      footerCopy(undefined).key, footerCopy({ total: 1, partialTotal: null }).key, footerCopy({ total: 0, partialTotal: 2 }).key,
      footerCopy({ total: 0, partialTotal: null }).key,
      ...bannerCopy({ partial: true, widen: { radiusKm: 100, count: 3 } }, 50, true).map((c) => c.key),
      ...bannerCopy({ partial: true, widen: { radiusKm: null, count: 3 } }, null, true).map((c) => c.key),
      noResultsCopy({ widen: { radiusKm: 100, count: 1 } }, 50, true).title.key,
      noResultsCopy({ widen: { radiusKm: 100, count: 1 } }, 50, true).widen!.key,
      noResultsCopy({ widen: { radiusKm: null, count: 1 } }, null, false).title.key,
      noResultsCopy({ widen: { radiusKm: null, count: 1 } }, null, false).widen!.key,
      'discover.search.results.count',
      ...SEARCH_SORTS.flatMap((s) => [`discover.search.order.${s}`, `discover.search.sort.${s}`]),
    ];
    for (const lang of ['en', 'hi', 'gu'] as const) {
      const set = keysOf(lang);
      expect(keys.filter((k) => !has(set, k)), lang).toEqual([]);
    }
  });

  it('search_submitted carries counts and kinds, never words', () => {
    const props = submittedProps(reading({ words: ['gear', 'pump'], brand: { id: 'b', name: 'Kirloskar' } }), { kinds: ['part'] });
    expect(props).toEqual({ words: 2, chips: 1, kinds: 'part' });
    expect(JSON.stringify(props)).not.toMatch(/gear|pump|Kirloskar/);
  });
});

describe('withRentalDates (M14 "Free on")', () => {
  const rentals: ResultsRequest = { q: 'jcb', filters: { kinds: ['machine_rental'] } };

  it('sets the dates on a rentals-only list; one day is from = to', () => {
    expect(withRentalDates(rentals, { from: '2099-03-01', to: '2099-03-03' }).filters?.rentalDates)
      .toEqual({ from: '2099-03-01', to: '2099-03-03' });
    expect(withRentalDates(rentals, { from: '2099-03-01' }).filters?.rentalDates).toEqual({ from: '2099-03-01', to: '2099-03-01' });
  });

  it('never sets them on a list that is not rentals only, and null clears them', () => {
    expect(withRentalDates({ filters: { kinds: ['machine', 'machine_rental'] } }, { from: '2099-03-01' }).filters?.rentalDates).toBeUndefined();
    expect(withRentalDates({ q: 'jcb' }, { from: '2099-03-01' }).filters).toBeUndefined();
    const dated = withRentalDates(rentals, { from: '2099-03-01', to: '2099-03-03' });
    expect(withRentalDates(dated, null)).toEqual(rentals);
    expect(withRentalDates(rentals, { from: '2020-01-01', to: '2020-01-03' }).filters?.rentalDates).toBeUndefined();
  });
});
