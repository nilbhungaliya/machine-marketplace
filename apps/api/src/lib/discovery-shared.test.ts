import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RADIUS_KM,
  DISCOVERY_ERROR_CODES,
  DISCOVERY_LIMITS,
  DISCOVERY_RADII_KM,
  LISTING_CARD_TAGS,
  MIN_QTY_STEPS,
  ORIGIN_SOURCES,
  REMOVABLE_CHIPS,
  SEARCH_REFRESH_SCOPES,
  SEARCH_SCRIPTS,
  SEARCH_SORTS,
  SYNONYM_TARGETS,
  cleanFilters,
  type SearchFilters,
} from '@mpm/shared-types';

// F4 + F5 discovery contracts (spec 2026-11-19-f4-f5-discovery-design §4.7, §5.7, §10; plan B0-1).

describe('discovery constants', () => {
  it('has the radii, default radius and sorts of the spec', () => {
    expect(DISCOVERY_RADII_KM).toEqual([10, 25, 50, 100, 200]);
    expect(DEFAULT_RADIUS_KM).toBe(50);
    expect(DISCOVERY_RADII_KM).toContain(DEFAULT_RADIUS_KM);
    expect(SEARCH_SORTS).toEqual(['best_match', 'nearest', 'newest', 'price_asc', 'price_desc', 'year_desc', 'hours_asc']);
    expect(MIN_QTY_STEPS).toEqual([2, 10, 50]);
  });

  it('has the enums of the data model', () => {
    expect(SYNONYM_TARGETS).toEqual(['category', 'brand', 'model', 'side', 'word']);
    expect(SEARCH_SCRIPTS).toEqual(['latin', 'devanagari', 'gujarati']);
    expect(SEARCH_REFRESH_SCOPES).toEqual(['category', 'brand', 'model', 'field', 'condition']);
    expect(REMOVABLE_CHIPS).toEqual(['side', 'brand', 'model', 'category', 'partNumber']);
    expect(LISTING_CARD_TAGS).toEqual(['reserved', 'on_rent', 'pair_contains_left', 'pair_contains_right']);
    expect(ORIGIN_SOURCES).toEqual(['gps', 'pincode', 'business', 'out_of_range']);
  });

  it('lists the new error codes (§10)', () => {
    expect([...DISCOVERY_ERROR_CODES].sort()).toEqual(
      [
        'LOCATION_REQUIRED', 'SORT_NEEDS_MACHINES', 'FILTER_NOT_AVAILABLE', 'CURSOR_INVALID', 'PINCODE_UNKNOWN',
        'CANNOT_SAVE_OWN_LISTING', 'SAVED_LIMIT', 'SYNONYM_EXISTS', 'SYNONYM_TARGET_INVALID',
      ].sort(),
    );
  });

  it('has the exact numbers of the spec', () => {
    expect(DISCOVERY_LIMITS).toEqual({
      pageSize: 20,
      suggestMinChars: 2,
      suggestMax: 8,
      suggestDebounceMs: 250,
      countDebounceMs: 300,
      recentSearches: 10,
      recentlyViewed: 20,
      savedCap: 500,
      cardsMaxIds: 20,
      maxWords: 10,
      maxPartNumbers: 3,
      maxSynonymPhraseWords: 4,
      readerVersionCheckMs: 5_000,
      suggestCountCacheMs: 90_000,
      trendingWindowDays: 7,
      trendingMinDays: 3,
      trendingMinSearches: 5,
      trendingTop: 10,
      adminTrendingTop: 20,
      zeroResultsWindowDays: 30,
      zeroResultsTop: 50,
      logRetentionDays: 90,
      logQueryMaxLength: 200,
      refreshJobIntervalMs: 30_000,
      refreshBatchSize: 200,
      refreshMaxAttempts: 5,
      trigramThreshold: 0.6,
      suggestTrigramThreshold: 0.5,
      rateLimitSearch: 120,
      rateLimitCount: 240,
      rateLimitSuggest: 240,
      rateLimitOther: 120,
      rateLimitIpOuter: 1_200,
      gpsCacheMs: 600_000,
      gpsDecimals: 3,
      snapDegrees: 0.01,
      homeSectionSize: 8,
      homeRestrictMinItems: 4,
      popularBrands: 6,
    });
  });
});

describe('cleanFilters', () => {
  it('drops empty arrays, nulls, empty strings, false toggles and empty spec entries', () => {
    const filters = {
      kinds: [],
      categoryId: '',
      side: null,
      conditionIds: [],
      states: [],
      cities: ['Surat'],
      industrialAreaIds: [],
      priceMinPaise: null,
      priceMaxPaise: 500_000,
      hidePriceOnRequest: false,
      minQty: null,
      gstVerifiedOnly: false,
      delivers: true,
      hasVideo: false,
      fit: null,
      specs: { width: [], gauge: {}, travel: { min: undefined, max: null }, colour: ['red'] },
    } as unknown as SearchFilters;
    expect(cleanFilters(filters)).toEqual({ cities: ['Surat'], delivers: true, priceMaxPaise: 500_000, specs: { colour: ['red'] } });
  });

  it('keeps radiusKm null (All India) but drops an absent one', () => {
    expect(cleanFilters({ radiusKm: null })).toEqual({ radiusKm: null });
    expect(cleanFilters({ radiusKm: 25 })).toEqual({ radiusKm: 25 });
    expect(cleanFilters({})).toEqual({});
    expect(cleanFilters(undefined)).toEqual({});
  });

  it('drops a fit without a brand and the empty parts of a fit', () => {
    expect(cleanFilters({ fit: { brandId: '' } })).toEqual({});
    expect(cleanFilters({ fit: { brandId: 'b', modelId: null, year: null } as unknown as SearchFilters['fit'] })).toEqual({
      fit: { brandId: 'b' },
    });
  });

  it('drops a spec range with neither end and an empty specs object', () => {
    expect(cleanFilters({ specs: { a: {}, b: [] } })).toEqual({});
    expect(cleanFilters({ specs: { a: { min: 0 } } })).toEqual({ specs: { a: { min: 0 } } });
  });

  it('gives the same output, key order included, for permuted input', () => {
    const a: SearchFilters = {
      kinds: ['machine', 'part'],
      side: 'left',
      conditionIds: ['c2', 'c1', 'c2'],
      fit: { year: 2015, brandId: 'b1', modelId: 'm1' },
      specs: { z: ['y', 'x'], a: { max: 9, min: 1 } },
      radiusKm: 100,
      gstVerifiedOnly: true,
    };
    const b: SearchFilters = {
      gstVerifiedOnly: true,
      radiusKm: 100,
      specs: { a: { min: 1, max: 9 }, z: ['x', 'y'] },
      fit: { modelId: 'm1', brandId: 'b1', year: 2015 },
      conditionIds: ['c1', 'c2'],
      side: 'left',
      kinds: ['part', 'machine'],
    };
    const ca = cleanFilters(a);
    const cb = cleanFilters(b);
    expect(JSON.stringify(ca)).toBe(JSON.stringify(cb));
    expect(Object.keys(ca)).toEqual([...Object.keys(ca)].sort());
    expect(ca.conditionIds).toEqual(['c1', 'c2']);
    expect(ca.kinds).toEqual(['machine', 'part']);
  });

  it('does not change its input', () => {
    const input: SearchFilters = { conditionIds: ['b', 'a'], kinds: [] };
    cleanFilters(input);
    expect(input).toEqual({ conditionIds: ['b', 'a'], kinds: [] });
  });
});
