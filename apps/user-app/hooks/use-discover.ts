import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DISCOVERY_LIMITS,
  type BrandBrowseRequest, type BrowseRequest, type DiscoveryOrigin, type DiscoveryRadiusKm, type SearchCountRequest,
  type SearchRequest, type SearchResponse,
} from '@mpm/shared-types';
import { errorCode } from '@/lib/api-error';
import {
  countSearch, fetchBrandView, fetchBrowse, fetchCards, fetchHome, fetchSuggestions, fetchTrending, isSearchRedirect,
  searchListings,
} from '@/lib/discover-api';
import { countRequest, searchPageRequest } from '@/lib/search-filters';

// Server state for discovery (F4 + F5 spec §7, §8): every key under `['discover', …]`, so the heart's toggle
// (`useSaveToggle`, hooks/use-saved.ts) patches every cached card. Keys hold the request bodies, origin included:
// they live in memory only and are never logged.

export const discoverKeys = {
  all: ['discover'] as const,
  search: (body: SearchCountRequest) => ['discover', 'search', body] as const,
  count: (body: SearchCountRequest) => ['discover', 'count', body] as const,
  home: (origin: DiscoveryOrigin, radiusKm: DiscoveryRadiusKm | null) => ['discover', 'home', origin, radiusKm] as const,
  browse: (body: BrowseRequest) => ['discover', 'browse', body] as const,
  brand: (body: BrandBrowseRequest) => ['discover', 'brand', body] as const,
  cards: (ids: readonly string[], origin: DiscoveryOrigin) => ['discover', 'cards', ids, origin] as const,
  suggest: (q: string) => ['discover', 'suggest', q] as const,
  trending: ['discover', 'trending'] as const,
  saved: ['discover', 'saved'] as const,
};

const LIST_STALE = 60 * 1000;

/** `value` once it has stopped changing for `ms` (compared by JSON, so a rebuilt but equal object doesn't restart it). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const json = JSON.stringify(value);
  const [settled, setSettled] = useState(value);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const timer = setTimeout(() => setSettled(latest.current), ms);
    return () => clearTimeout(timer);
  }, [json, ms]);
  return settled;
}

/**
 * Search results as an infinite list (§8.4): page 1 without a cursor, then `nextCursor`. Every page and the count go
 * out with `frozenOrigin`, the origin captured when the list opened (R18), so a GPS refresh never breaks a list being
 * scrolled. A `CURSOR_INVALID` (a safety net) resets the list to page 1. Page 1 can be a `{ redirect }` (`#ref`).
 */
export function useSearch(request: SearchRequest | SearchCountRequest, frozenOrigin: DiscoveryOrigin, enabled = true) {
  const qc = useQueryClient();
  const body = useMemo(() => countRequest(request, frozenOrigin), [JSON.stringify(request), frozenOrigin]); // eslint-disable-line react-hooks/exhaustive-deps
  const queryKey = discoverKeys.search(body);
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }: { pageParam: string | null }) => searchListings(searchPageRequest(body, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last: SearchResponse) => (isSearchRedirect(last) ? undefined : last.nextCursor ?? undefined),
    enabled,
    staleTime: LIST_STALE,
    // A stale cursor is never retried: the effect below resets the list to page 1.
    retry: (failures, error) => errorCode(error) !== 'CURSOR_INVALID' && failures < 1,
  });
  const cursorInvalid = errorCode(query.error) === 'CURSOR_INVALID';
  useEffect(() => {
    if (cursorInvalid) void qc.resetQueries({ queryKey, exact: true });
  }, [cursorInvalid]); // eslint-disable-line react-hooks/exhaustive-deps
  return query;
}

/**
 * The Filters screen's live footer (§5.11): `{ total, partialTotal }`, 300 ms after the last change, with the **same
 * frozen origin as the list** (§8.4, R18).
 */
export function useCountOnly(request: SearchRequest | SearchCountRequest, frozenOrigin: DiscoveryOrigin, enabled = true) {
  const body = useMemo(() => countRequest(request, frozenOrigin), [JSON.stringify(request), frozenOrigin]); // eslint-disable-line react-hooks/exhaustive-deps
  const settled = useDebouncedValue(body, DISCOVERY_LIMITS.countDebounceMs);
  return useQuery({
    queryKey: discoverKeys.count(settled),
    queryFn: () => countSearch(settled),
    enabled,
    staleTime: LIST_STALE,
    placeholderData: (previous) => previous,
  });
}

/** Suggestions while typing (§5.12): 250 ms debounce, from 2 characters. */
export function useSuggest(q: string) {
  const text = useDebouncedValue(q.trim(), DISCOVERY_LIMITS.suggestDebounceMs);
  return useQuery({
    queryKey: discoverKeys.suggest(text),
    queryFn: () => fetchSuggestions(text),
    enabled: text.length >= DISCOVERY_LIMITS.suggestMinChars,
    staleTime: 30 * 1000,
  });
}

export function useTrending() {
  return useQuery({ queryKey: discoverKeys.trending, queryFn: fetchTrending, staleTime: 10 * 60 * 1000 });
}

/** Home (§8.3). Wait for the stored radius (`ready` from `useDiscoveryOrigin`) before enabling. */
export function useHome(origin: DiscoveryOrigin, radiusKm: DiscoveryRadiusKm | null, enabled = true) {
  return useQuery({
    queryKey: discoverKeys.home(origin, radiusKm),
    queryFn: () => fetchHome({ origin, radiusKm }),
    enabled,
    staleTime: LIST_STALE,
  });
}

/** Browse (§8.4): a catalogue node's children with live counts and popular brands. */
export function useBrowse(body: BrowseRequest, enabled = true) {
  return useQuery({ queryKey: discoverKeys.browse(body), queryFn: () => fetchBrowse(body), enabled, staleTime: LIST_STALE });
}

/** The brand view: models with counts and `allCount` (the `brandId` filter's total). */
export function useBrandView(body: BrandBrowseRequest, enabled = true) {
  return useQuery({ queryKey: discoverKeys.brand(body), queryFn: () => fetchBrandView(body), enabled, staleTime: LIST_STALE });
}

/** Cards for recently viewed ids (§8.5): the ones still public, in order. */
export function useCards(ids: readonly string[], origin: DiscoveryOrigin, enabled = true) {
  const list = ids.slice(0, DISCOVERY_LIMITS.cardsMaxIds);
  return useQuery({
    queryKey: discoverKeys.cards(list, origin),
    queryFn: () => fetchCards({ ids: list, origin }),
    enabled: enabled && list.length > 0,
    staleTime: LIST_STALE,
  });
}
