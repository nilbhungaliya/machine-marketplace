import {
  cleanFilters,
  DEFAULT_RADIUS_KM,
  REMOVABLE_CHIPS,
  type DiscoveryOrigin,
  type DiscoveryRadiusKm,
  type SearchCountRequest,
  type SearchFilters,
  type SearchRequest,
} from '@mpm/shared-types';
import { formatRupees } from './money';

// Search filters on the phone (F4 + F5 spec §5.7, §8.4): the "Filters n" count, the filter row's chip summaries (copy
// keys + params, translated by the screen), the radius label, and the request bodies built with the list's frozen
// origin (R18). Filters always go through `cleanFilters()` (shared with the API), so the cursor seal stays stable.

/** Copy key and params for `t()`. */
export interface CopyKey {
  key: string;
  params?: Record<string, string | number>;
}

export type FilterChipId =
  | 'side' | 'radius' | 'conditions' | 'fit' | 'place' | 'price' | 'minQty' | 'gstVerifiedOnly' | 'delivers' | 'hasVideo' | 'specs';

export interface ChipSummary extends CopyKey {
  /** Which filter group the chip shows (and clears when removed). */
  id: FilterChipId;
}

const hasPlace = (f: SearchFilters) => !!(f.states?.length || f.cities?.length || f.industrialAreaIds?.length);
const hasPrice = (f: SearchFilters) => f.priceMinPaise !== undefined || f.priceMaxPaise !== undefined || !!f.hidePriceOnRequest;

/**
 * The "Filters n" count: the groups the Filters screen sets (side, condition, fits machine, place, price, quantity,
 * GST verified, delivers, has video, one per spec field). Kinds, category and brand come from where the search was
 * opened, and the radius has its own chip, so they don't count.
 */
export function countFilters(filters: SearchFilters | null | undefined): number {
  const f = cleanFilters(filters);
  let n = 0;
  if (f.side) n++;
  if (f.conditionIds?.length) n++;
  if (f.fit) n++;
  if (hasPlace(f)) n++;
  if (hasPrice(f)) n++;
  if (f.minQty) n++;
  if (f.gstVerifiedOnly) n++;
  if (f.delivers) n++;
  if (f.hasVideo) n++;
  n += Object.keys(f.specs ?? {}).length;
  return n;
}

/** "Within 50 km" or "All India"; absent = the default 50 km (§5.7). */
export function radiusLabel(radiusKm: DiscoveryRadiusKm | null | undefined): CopyKey {
  if (radiusKm === null) return { key: 'discover.radius.allIndia' };
  return { key: 'discover.radius.within', params: { km: radiusKm ?? DEFAULT_RADIUS_KM } };
}

function priceChip(f: SearchFilters): CopyKey | null {
  const min = f.priceMinPaise;
  const max = f.priceMaxPaise;
  if (min !== undefined && max !== undefined) return { key: 'discover.chips.priceRange', params: { min: formatRupees(min), max: formatRupees(max) } };
  if (min !== undefined) return { key: 'discover.chips.priceFrom', params: { min: formatRupees(min) } };
  if (max !== undefined) return { key: 'discover.chips.priceUpTo', params: { max: formatRupees(max) } };
  if (f.hidePriceOnRequest) return { key: 'discover.chips.priceShown' };
  return null;
}

/** The filter row's chips for the filters set, in row order; the radius chip is always there. */
export function filterChipSummaries(filters: SearchFilters | null | undefined): ChipSummary[] {
  const f = cleanFilters(filters);
  const chips: ChipSummary[] = [];
  if (f.side) chips.push({ id: 'side', key: `discover.chips.side.${f.side}` });
  chips.push({ id: 'radius', ...radiusLabel(f.radiusKm) });
  if (f.conditionIds?.length) chips.push({ id: 'conditions', key: 'discover.chips.conditions', params: { count: f.conditionIds.length } });
  if (f.fit) chips.push({ id: 'fit', key: 'discover.chips.fit' });
  if (hasPlace(f)) {
    const count = (f.states?.length ?? 0) + (f.cities?.length ?? 0) + (f.industrialAreaIds?.length ?? 0);
    chips.push({ id: 'place', key: 'discover.chips.place', params: { count } });
  }
  const price = priceChip(f);
  if (price) chips.push({ id: 'price', ...price });
  if (f.minQty) chips.push({ id: 'minQty', key: 'discover.chips.minQty', params: { qty: f.minQty } });
  if (f.gstVerifiedOnly) chips.push({ id: 'gstVerifiedOnly', key: 'discover.chips.gstVerified' });
  if (f.delivers) chips.push({ id: 'delivers', key: 'discover.chips.delivers' });
  if (f.hasVideo) chips.push({ id: 'hasVideo', key: 'discover.chips.hasVideo' });
  const specs = Object.keys(f.specs ?? {}).length;
  if (specs) chips.push({ id: 'specs', key: 'discover.chips.specs', params: { count: specs } });
  return chips;
}

/**
 * The body of `POST /discover/search/count` (and page 1 of the list): words trimmed, filters cleaned, removed chips as
 * a sorted set, and the **frozen** origin of the list (R18), never the request's own or the current one.
 */
export function countRequest(request: SearchRequest | SearchCountRequest, frozenOrigin: DiscoveryOrigin): SearchCountRequest {
  const body: SearchCountRequest = {};
  const q = request.q?.trim();
  if (q) body.q = q;
  const filters = cleanFilters(request.filters);
  if (Object.keys(filters).length) body.filters = filters;
  const removed = REMOVABLE_CHIPS.filter((c) => request.removedChips?.includes(c));
  if (removed.length) body.removedChips = removed;
  if (request.sort) body.sort = request.sort;
  body.origin = frozenOrigin;
  return body;
}

/** One page of the list: the list's body plus the cursor (null for page 1). */
export function searchPageRequest(body: SearchCountRequest, cursor: string | null): SearchRequest {
  return { ...body, cursor };
}
