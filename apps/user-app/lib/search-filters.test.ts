import { describe, expect, it } from 'vitest';
import type { SearchFilters } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import { resources } from '@/locales';
import { countFilters, countRequest, filterChipSummaries, radiusLabel, searchPageRequest, type ChipSummary } from './search-filters';

type Tree = { [k: string]: string | Tree };
const flatten = (t: Tree, prefix = ''): string[] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)));
const keysOf = (lang: 'en' | 'hi' | 'gu') => new Set(flatten(resources[lang].translation as unknown as Tree));
/** A copy key exists in a language (a counted key as its `_one` / `_other` forms). */
const has = (keys: Set<string>, key: string) => keys.has(key) || (keys.has(`${key}_one`) && keys.has(`${key}_other`));

const full: SearchFilters = {
  kinds: ['part'],
  categoryId: 'c1',
  brandId: 'b1',
  radiusKm: 25,
  side: 'left',
  conditionIds: ['n', 'u'],
  fit: { brandId: 'b2', modelId: 'm2' },
  states: ['Gujarat'],
  cities: ['Rajkot', 'Morbi'],
  priceMinPaise: 50_000,
  priceMaxPaise: 300_000,
  minQty: 10,
  gstVerifiedOnly: true,
  delivers: true,
  hasVideo: true,
  specs: { bore: ['63'], stroke: { min: 100 } },
};

describe('filter count (Filters n, spec §8.4)', () => {
  it('counts what the Filters screen sets, not the kinds, category, brand or radius', () => {
    expect(countFilters({})).toBe(0);
    expect(countFilters({ kinds: ['part'], categoryId: 'c', brandId: 'b', radiusKm: null })).toBe(0);
    // side, condition, fit, place, price, quantity, gst, delivers, video, 2 specs
    expect(countFilters(full)).toBe(11);
  });

  it('ignores empty values (the same canonical form as the API)', () => {
    expect(countFilters({ conditionIds: [], states: [], specs: { bore: [] }, gstVerifiedOnly: false })).toBe(0);
    expect(countFilters({ hidePriceOnRequest: true })).toBe(1);
    expect(countFilters({ priceMinPaise: 1, priceMaxPaise: 2, hidePriceOnRequest: true })).toBe(1);
  });
});

describe('chip summaries', () => {
  it('one chip per group, in the filter row order, with copy keys and params', () => {
    const chips = filterChipSummaries(full);
    expect(chips.map((c) => c.id)).toEqual([
      'side', 'radius', 'conditions', 'fit', 'place', 'price', 'minQty', 'gstVerifiedOnly', 'delivers', 'hasVideo', 'specs',
    ]);
    const by = Object.fromEntries(chips.map((c) => [c.id, c])) as Record<string, ChipSummary>;
    expect(by.side).toEqual({ id: 'side', key: 'discover.chips.side.left' });
    expect(by.radius).toEqual({ id: 'radius', key: 'discover.radius.within', params: { km: 25 } });
    expect(by.conditions).toEqual({ id: 'conditions', key: 'discover.chips.conditions', params: { count: 2 } });
    expect(by.place).toEqual({ id: 'place', key: 'discover.chips.place', params: { count: 3 } });
    expect(by.price.key).toBe('discover.chips.priceRange');
    expect(by.minQty).toEqual({ id: 'minQty', key: 'discover.chips.minQty', params: { qty: 10 } });
    expect(by.specs).toEqual({ id: 'specs', key: 'discover.chips.specs', params: { count: 2 } });
  });

  it('price chip copy for a floor, a ceiling, or only "with a price"', () => {
    const price = (f: SearchFilters) => filterChipSummaries(f).find((c) => c.id === 'price');
    expect(price({ priceMinPaise: 50_000 })?.key).toBe('discover.chips.priceFrom');
    expect(price({ priceMaxPaise: 50_000 })?.key).toBe('discover.chips.priceUpTo');
    expect(price({ hidePriceOnRequest: true })?.key).toBe('discover.chips.priceShown');
    expect(price({})).toBeUndefined();
    expect(i18n.t(price({ priceMinPaise: 50_000, priceMaxPaise: 300_000 })!.key, price({ priceMinPaise: 50_000, priceMaxPaise: 300_000 })!.params))
      .toBe('₹500 – ₹3,000');
  });

  it('the radius chip is always there: default 50 km, or All India', () => {
    expect(filterChipSummaries({}).map((c) => c.id)).toEqual(['radius']);
    expect(filterChipSummaries({})[0]).toEqual({ id: 'radius', key: 'discover.radius.within', params: { km: 50 } });
    expect(filterChipSummaries({ radiusKm: null })[0]).toEqual({ id: 'radius', key: 'discover.radius.allIndia' });
  });

  it('every chip key exists in en, hi and gu', () => {
    const sides: SearchFilters[] = [{ side: 'left' }, { side: 'right' }, { side: 'pair' }, { radiusKm: null }];
    const all = [full, ...sides, { priceMinPaise: 1 }, { priceMaxPaise: 1 }, { hidePriceOnRequest: true }]
      .flatMap((f) => filterChipSummaries(f).map((c) => c.key));
    for (const lang of ['en', 'hi', 'gu'] as const) {
      const keys = keysOf(lang);
      for (const key of all) expect(has(keys, key), `${lang}: ${key}`).toBe(true);
    }
  });
});

describe('radius label', () => {
  it('Within n km, All India, or the default 50', () => {
    expect(radiusLabel(100)).toEqual({ key: 'discover.radius.within', params: { km: 100 } });
    expect(radiusLabel(null)).toEqual({ key: 'discover.radius.allIndia' });
    expect(radiusLabel(undefined)).toEqual({ key: 'discover.radius.within', params: { km: 50 } });
    expect(i18n.t(radiusLabel(10).key, radiusLabel(10).params)).toBe('Within 10 km');
  });
});

describe('requests with a frozen origin (R18, §8.4)', () => {
  const frozen = Object.freeze({ point: Object.freeze({ lat: 22.3, lng: 70.8 }) });
  const current = { point: { lat: 22.9, lng: 71.2 } };

  it('count-only uses the frozen origin, not the request one or the current one, and no cursor', () => {
    const req = { q: ' gear ', filters: { conditionIds: [], side: 'left' as const }, origin: current, cursor: 'abc', sort: 'nearest' as const };
    const body = countRequest(req, frozen);
    expect(body).toEqual({ q: 'gear', filters: { side: 'left' }, sort: 'nearest', origin: { point: { lat: 22.3, lng: 70.8 } } });
    expect(body).not.toHaveProperty('cursor');
  });

  it('a page of the same list sends the same origin with its cursor', () => {
    const base = countRequest({ q: 'gear', filters: { radiusKm: null } }, frozen);
    expect(searchPageRequest(base, null)).toEqual({ ...base, cursor: null });
    expect(searchPageRequest(base, 'c2')).toEqual({ ...base, cursor: 'c2' });
  });

  it('drops empty words, chips and filters; keeps radius null (All India)', () => {
    expect(countRequest({ q: '  ', removedChips: [], filters: {} }, null)).toEqual({ origin: null });
    expect(countRequest({ removedChips: ['side'], filters: { radiusKm: null } }, null)).toEqual({
      removedChips: ['side'], filters: { radiusKm: null }, origin: null,
    });
  });
});
