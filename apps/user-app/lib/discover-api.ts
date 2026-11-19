import type {
  ApiSuccess, BrandBrowseRequest, BrandBrowseView, BrowseRequest, BrowseView, CardsRequest, CountOnlyResult, HomeRequest,
  HomeView, ListingCard, SearchCountRequest, SearchRedirect, SearchRequest, SearchResponse, Suggestion,
} from '@mpm/shared-types';
import api from './api';

// One function per public discovery route (F4 + F5 spec §7, `apps/api/src/routes/discover.ts`). Guests can call them
// all. Origins travel in POST bodies only (R3); `X-Install-Id` is added by `lib/api.ts`. Errors are axios errors: map
// them with `lib/listing-errors.ts`.

const data = <T>(p: Promise<{ data: ApiSuccess<T> }>): Promise<T> => p.then((r) => r.data.data);

/** POST /discover/search → a page, or `{ redirect }` for a `#ref` of a public listing. */
export function searchListings(body: SearchRequest): Promise<SearchResponse> {
  return data(api.post<ApiSuccess<SearchResponse>>('/discover/search', body));
}

export function isSearchRedirect(r: SearchResponse): r is SearchRedirect {
  return 'redirect' in r;
}

/** POST /discover/search/count → `{ total, partialTotal }` (the Filters screen's live footer, §5.11). */
export function countSearch(body: SearchCountRequest): Promise<CountOnlyResult> {
  return data(api.post<ApiSuccess<CountOnlyResult>>('/discover/search/count', body));
}

/** GET /discover/suggest?q= (at least 2 characters). */
export function fetchSuggestions(q: string): Promise<Suggestion[]> {
  return data(api.get<ApiSuccess<Suggestion[]>>('/discover/suggest', { params: { q } }));
}

/** GET /discover/trending → normalised queries. */
export function fetchTrending(): Promise<string[]> {
  return data(api.get<ApiSuccess<string[]>>('/discover/trending'));
}

export function fetchHome(body: HomeRequest): Promise<HomeView> {
  return data(api.post<ApiSuccess<HomeView>>('/discover/home', body));
}

export function fetchBrowse(body: BrowseRequest): Promise<BrowseView> {
  return data(api.post<ApiSuccess<BrowseView>>('/discover/browse', body));
}

export function fetchBrandView(body: BrandBrowseRequest): Promise<BrandBrowseView> {
  return data(api.post<ApiSuccess<BrandBrowseView>>('/discover/browse/brand', body));
}

/** POST /discover/cards (≤ 20 ids, recently viewed) → the ones still public, in the given order. */
export function fetchCards(body: CardsRequest): Promise<ListingCard[]> {
  return data(api.post<ApiSuccess<ListingCard[]>>('/discover/cards', body));
}
