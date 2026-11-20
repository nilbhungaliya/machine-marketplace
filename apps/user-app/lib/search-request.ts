import {
  cleanFilters,
  REMOVABLE_CHIPS,
  SEARCH_SORTS,
  type CountOnlyResult,
  type DiscoveryRadiusKm,
  type ListingKind,
  type QueryReading,
  type RemovableChip,
  type SearchFilters,
  type SearchPage,
  type SearchSort,
} from '@mpm/shared-types';
import type { CopyKey, FilterChipId } from './search-filters';
import { istDateKey } from './ist-date';

// The results list's request on the phone (F4 + F5 spec §5.3, §5.6, §5.8, §5.11, §8.4): what the results screen keeps
// in its route params (words, filters, removed chips, sort), the reader's chips and what removing one does, the reset
// rules when filters change, the sort choices, and the copy of the count footer, the partial banner and No results.
// Pure; the screens translate the copy keys. The origin is not part of it: the screen freezes it per list (R18).

/** The results screen's request (its route params): everything but the origin and the cursor. */
export interface ResultsRequest {
  q?: string;
  filters?: SearchFilters;
  removedChips?: RemovableChip[];
  sort?: SearchSort;
}

const MACHINE_KINDS: readonly ListingKind[] = ['machine', 'machine_rental'];
const MACHINE_SORTS: readonly SearchSort[] = ['year_desc', 'hours_asc'];

/** Kinds that allow the machine sorts (year, hours): at least one kind, all of them machines (`SORT_NEEDS_MACHINES`). */
export function machinesOnly(kinds: readonly ListingKind[] | null | undefined): boolean {
  return !!kinds?.length && kinds.every((k) => MACHINE_KINDS.includes(k));
}

/** Rentals only (Home's "For rent", Machines for rent): the results show as a grid of `GridCard`s (§8.4). */
export function rentalsOnly(filters: SearchFilters | null | undefined): boolean {
  const kinds = filters?.kinds ?? [];
  return kinds.length > 0 && kinds.every((k) => k === 'machine_rental');
}

/**
 * The request in one canonical form: words trimmed (none → absent), filters cleaned, removed chips as a sorted set,
 * and a machine-only sort dropped when the kinds no longer allow it (back to the R10 default).
 */
export function normaliseRequest(request: ResultsRequest): ResultsRequest {
  const out: ResultsRequest = {};
  const q = request.q?.trim();
  if (q) out.q = q;
  const filters = cleanFilters(request.filters);
  // "Free on" dates kept past IST midnight start in the past: the API refuses them (`RENTAL_DATES_INVALID`).
  if (filters.rentalDates && filters.rentalDates.from < istDateKey()) delete filters.rentalDates;
  if (Object.keys(filters).length) out.filters = filters;
  const removed = REMOVABLE_CHIPS.filter((c) => request.removedChips?.includes(c));
  if (removed.length) out.removedChips = removed;
  if (request.sort && !(MACHINE_SORTS.includes(request.sort) && !machinesOnly(filters.kinds))) out.sort = request.sort;
  return out;
}

/** New words typed in the results bar: a new list. Filters stay; removed chips and the sort start again (R10). */
export function withQuery(request: ResultsRequest, q: string): ResultsRequest {
  return normaliseRequest({ q, filters: request.filters });
}

/** The Filters screen's Show button: its filters replace the list's (the sort is checked against the new kinds). */
export function withFilters(request: ResultsRequest, filters: SearchFilters): ResultsRequest {
  return normaliseRequest({ ...request, filters });
}

export function withSort(request: ResultsRequest, sort: SearchSort): ResultsRequest {
  return normaliseRequest({ ...request, sort });
}

/**
 * M14 "Free on" (spec §10, R13): the rentals list's dates, set only while the list is rentals only (the filter means
 * nothing for parts and machines for sale); `null` clears them. A one-day pick is `{ from, to: from }`.
 */
export function withRentalDates(request: ResultsRequest, range: { from: string; to?: string } | null): ResultsRequest {
  const filters: SearchFilters = { ...request.filters };
  delete filters.rentalDates;
  if (range && rentalsOnly(request.filters)) filters.rentalDates = { from: range.from, to: range.to ?? range.from };
  return normaliseRequest({ ...request, filters });
}

/** "Widen": the same list at the next radius with full matches (§5.6); null = All India. */
export function withRadius(request: ResultsRequest, radiusKm: DiscoveryRadiusKm | null): ResultsRequest {
  return normaliseRequest({ ...request, filters: { ...request.filters, radiusKm } });
}

// ─── Chips ───

/** A chip of the query reader (§5.3, R8): its label is catalogue text (`text`) or a copy key (`copy`). */
export interface ReadingChip {
  id: RemovableChip;
  text?: string;
  copy?: CopyKey;
}

/**
 * The reader's removable chips, from the page's `reading` (which already carries the explicit filters that override
 * it: side, category, brand). Word synonyms (`wordGroups`) are words, never chips.
 */
export function readingChips(reading: QueryReading | null | undefined): ReadingChip[] {
  if (!reading) return [];
  const chips: ReadingChip[] = [];
  if (reading.category) chips.push({ id: 'category', text: reading.category.name });
  if (reading.brand) chips.push({ id: 'brand', text: reading.brand.name });
  if (reading.model) chips.push({ id: 'model', text: reading.model.name });
  if (reading.partNumbers.length) chips.push({ id: 'partNumber', text: reading.partNumbers.map((p) => p.toUpperCase()).join(', ') });
  if (reading.side) chips.push({ id: 'side', copy: { key: `discover.chips.side.${reading.side}` } });
  return chips;
}

/**
 * Removing a reader chip (×). A chip can come from the words (the reader) or from an explicit filter (a suggestion,
 * Browse, the Filters screen), so both go: the filter of that kind is cleared, and with words the chip is listed in
 * `removedChips` (a brand / model / category / part-number chip's words go back to plain words; a side chip's words
 * are dropped, R8). The category in play goes with its spec filters (`FILTER_NOT_AVAILABLE` otherwise).
 */
export function removeReadingChip(request: ResultsRequest, chip: RemovableChip): ResultsRequest {
  const filters: SearchFilters = { ...request.filters };
  if (chip === 'side') delete filters.side;
  if (chip === 'brand') delete filters.brandId;
  if (chip === 'category') {
    delete filters.categoryId;
    delete filters.specs;
  }
  const removed = new Set(request.removedChips ?? []);
  if (request.q?.trim()) removed.add(chip);
  return normaliseRequest({ ...request, filters, removedChips: [...removed] });
}

/** Filter chips that can be cleared from the row (×): the Filters screen's groups, the fit and the listing type. */
export type ClearableFilter = Exclude<FilterChipId, 'radius'> | 'kinds';

/** Clears one filter group from the row; removing the listing type also drops a machine-only sort. */
export function clearFilter(request: ResultsRequest, id: ClearableFilter): ResultsRequest {
  const f: SearchFilters = { ...request.filters };
  switch (id) {
    case 'side': return removeReadingChip(request, 'side');
    case 'conditions': delete f.conditionIds; break;
    case 'fit': delete f.fit; break;
    case 'place': delete f.states; delete f.cities; delete f.industrialAreaIds; break;
    case 'price': delete f.priceMinPaise; delete f.priceMaxPaise; delete f.hidePriceOnRequest; break;
    case 'minQty': delete f.minQty; break;
    case 'gstVerifiedOnly': delete f.gstVerifiedOnly; break;
    case 'delivers': delete f.delivers; break;
    case 'hasVideo': delete f.hasVideo; break;
    case 'specs': delete f.specs; break;
    case 'kinds': delete f.kinds; delete f.rentalDates; break;
  }
  return normaliseRequest({ ...request, filters: f });
}

/**
 * The Filters screen's "Clear all": every group it sets goes (the ones `countFilters` counts); where the search came
 * from stays (listing type, category, brand) and so does the distance.
 */
export function clearAllFilters(filters: SearchFilters | null | undefined): SearchFilters {
  const f = cleanFilters(filters);
  const kept: SearchFilters = {};
  if (f.kinds) kept.kinds = f.kinds;
  if (f.categoryId) kept.categoryId = f.categoryId;
  if (f.brandId) kept.brandId = f.brandId;
  if (f.radiusKm !== undefined) kept.radiusKm = f.radiusKm;
  return kept;
}

// ─── Sort ───

/** The sort sheet's choices (§5.8): nearest only with a location, year and hours only for machines. */
export function sortOptions(opts: { kinds?: readonly ListingKind[] | null; hasOrigin: boolean }): SearchSort[] {
  return SEARCH_SORTS.filter((s) => {
    if (s === 'nearest') return opts.hasOrigin;
    if (MACHINE_SORTS.includes(s)) return machinesOnly(opts.kinds);
    return true;
  });
}

// ─── Copy ───

/** The count line: "14 results, nearest first" (the sort the server applied). */
export function countLine(total: number, sort: SearchSort): CopyKey & { orderKey: string } {
  return { key: 'discover.search.results.count', params: { count: total }, orderKey: `discover.search.order.${sort}` };
}

/** The Filters footer (§5.11): Show 14 results · No exact matches, Show 6 close ones · No results (disabled). */
export function footerCopy(count: CountOnlyResult | null | undefined): CopyKey & { disabled: boolean } {
  if (!count) return { key: 'discover.search.filters.showResults', disabled: false };
  if (count.total > 0) return { key: 'discover.search.filters.show', params: { count: count.total }, disabled: false };
  if (count.partialTotal && count.partialTotal > 0) {
    return { key: 'discover.search.filters.showClose', params: { count: count.partialTotal }, disabled: false };
  }
  return { key: 'discover.search.filters.noResults', disabled: true };
}

/** The radius a list searched within, or null for All India / no origin. */
function within(radiusKm: DiscoveryRadiusKm | null | undefined, hasOrigin: boolean): number | null {
  return hasOrigin && radiusKm != null ? radiusKm : null;
}

/**
 * The partial banner (§5.6): "No exact matches within 50 km." and, when `widen` is set, "3 exact matches within
 * 100 km" (or "across India"). Empty when the page has full matches.
 */
export function bannerCopy(
  page: Pick<SearchPage, 'partial' | 'widen'>,
  radiusKm: DiscoveryRadiusKm | null | undefined,
  hasOrigin: boolean,
): CopyKey[] {
  if (!page.partial) return [];
  const km = within(radiusKm, hasOrigin);
  const out: CopyKey[] = [km === null
    ? { key: 'discover.search.partial.none' }
    : { key: 'discover.search.partial.noneWithin', params: { km } }];
  if (page.widen) {
    out.push(page.widen.radiusKm === null
      ? { key: 'discover.search.partial.exactAllIndia', params: { count: page.widen.count } }
      : { key: 'discover.search.partial.exactWithin', params: { count: page.widen.count, km: page.widen.radiusKm } });
  }
  return out;
}

/** No results: the title, and the widen button when a larger radius has full matches. */
export function noResultsCopy(
  page: Pick<SearchPage, 'widen'>,
  radiusKm: DiscoveryRadiusKm | null | undefined,
  hasOrigin: boolean,
): { title: CopyKey; widen: CopyKey | null } {
  const km = within(radiusKm, hasOrigin);
  const title: CopyKey = km === null ? { key: 'discover.search.noResults.title' } : { key: 'discover.search.noResults.titleWithin', params: { km } };
  let widen: CopyKey | null = null;
  if (page.widen) {
    widen = page.widen.radiusKm === null
      ? { key: 'discover.search.noResults.widenAllIndia', params: { count: page.widen.count } }
      : { key: 'discover.search.noResults.widen', params: { count: page.widen.count, km: page.widen.radiusKm } };
  }
  return { title, widen };
}

/** `search_submitted` props (§8.6): counts and kinds only, never the words themselves. */
export function submittedProps(reading: QueryReading, filters: SearchFilters | null | undefined): { words: number; chips: number; kinds: string } {
  return {
    words: reading.words.length + reading.wordGroups.length,
    chips: readingChips(reading).length,
    kinds: [...(filters?.kinds ?? [])].sort().join(',') || 'all',
  };
}
