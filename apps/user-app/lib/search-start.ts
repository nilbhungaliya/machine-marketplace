import type { BrowseView, Suggestion } from '@mpm/shared-types';
import type { ResultsRequest } from './search-request';

// The Search tab's start (F4 + F5 spec §8.4): where it opens (its params), Browse's crumbs and rows, and what a
// suggestion shows and opens. Pure; the screen translates.

/** The Search tab's params (B5-1): Home's category tiles open Browse at a node; Home's search bar opens it focused. */
export interface SearchTabParams {
  browseNodeId?: string;
  focus?: boolean;
}

export function startState(params: SearchTabParams | null | undefined): { browseNodeId: string | null; focus: boolean } {
  return { browseNodeId: params?.browseNodeId || null, focus: params?.focus === true };
}

/** One crumb: `id` null is the root ("All categories"); `current` is the node on screen (not pressable). */
export interface Crumb {
  id: string | null;
  name: string | null;
  current: boolean;
}

/** "All categories › Earthmoving › Backhoe loaders" (the view's crumbs end with its node). */
export function browseCrumbs(view: Pick<BrowseView, 'crumbs'> | null | undefined): Crumb[] {
  const crumbs = view?.crumbs ?? [];
  return [
    { id: null, name: null, current: crumbs.length === 0 },
    ...crumbs.map((c, i) => ({ id: c.id, name: c.name, current: i === crumbs.length - 1 })),
  ];
}

/** A Browse row opens its children, except a part group (the tree's last level), which opens its results. */
export function browseRowOpens(child: Pick<BrowseView['children'][number], 'level'>): 'drill' | 'results' {
  return child.level === 'part_group' ? 'results' : 'drill';
}

/** A suggestion row: catalogue text as typed by the admin, the copy key of its kind, and its count. */
export interface SuggestionRow {
  title: string;
  /** The category's path ("Earthmoving › Backhoe loaders"), a model's brand, or the listing's title. */
  subtitle: string | null;
  /** `discover.search.suggest.<type>`: "Category", "Brand", "Model", "Listing #{{ref}}". */
  typeKey: string;
  ref: number | null;
  count: number;
}

export function suggestionRow(s: Suggestion): SuggestionRow {
  if (s.type === 'listing') {
    return { title: s.name, subtitle: null, typeKey: 'discover.search.suggest.listing', ref: s.ref ?? null, count: s.liveCount };
  }
  return {
    title: s.name,
    subtitle: s.path.length ? s.path.join(' › ') : null,
    typeKey: `discover.search.suggest.${s.type}`,
    ref: null,
    count: s.liveCount,
  };
}

export type SuggestionTarget =
  | { screen: 'Listing'; listingId: string }
  | { screen: 'SearchResults'; request: ResultsRequest };

/**
 * What a suggestion opens: a listing opens its page; a category or a brand opens results with that filter (it overrides
 * the reader, §5.3); a model opens results for "<brand> <model>", which the reader turns into the brand and model chips
 * (a suggestion carries the model's brand name only, as its path).
 */
export function suggestionTarget(s: Suggestion): SuggestionTarget {
  switch (s.type) {
    case 'listing': return { screen: 'Listing', listingId: s.id };
    case 'category': return { screen: 'SearchResults', request: { filters: { categoryId: s.id } } };
    case 'brand': return { screen: 'SearchResults', request: { filters: { brandId: s.id } } };
    case 'model': return { screen: 'SearchResults', request: { q: [s.path[0], s.name].filter(Boolean).join(' ') } };
  }
}
