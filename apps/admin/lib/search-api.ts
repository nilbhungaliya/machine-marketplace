import type {
  CatalogLevel, QueryReading, SearchScript, SearchSide, SearchSynonym, SearchSynonymInput, SearchSynonymPage, SynonymTarget,
  TrendingHiddenResult, TrendingRow, ZeroResultRow,
} from '@mpm/shared-types';
import { api, ApiError } from './api';

// Typed calls to the admin search API (F4 + F5 spec §7.1, §9: category_manager, super_admin passes). Each returns the
// endpoint's `data`.

export interface SynonymListFilters {
  q?: string;
  /** '' = every kind. */
  targetKind?: SynonymTarget | '';
  cursor?: string | null;
}

/** The list's query string, values left out when empty. */
export function synonymsQuery(f: SynonymListFilters): string {
  const sp = new URLSearchParams();
  const q = f.q?.trim();
  if (q) sp.set('q', q);
  if (f.targetKind) sp.set('targetKind', f.targetKind);
  if (f.cursor) sp.set('cursor', f.cursor);
  return sp.toString();
}

/** 50 per page by normalised term; `nextCursor` until the last page. 400 CURSOR_INVALID when the cursor is stale. */
export function fetchSynonyms(f: SynonymListFilters): Promise<SearchSynonymPage> {
  const qs = synonymsQuery(f);
  return api.get<SearchSynonymPage>(`/admin/search/synonyms${qs ? `?${qs}` : ''}`);
}

/** 409 SYNONYM_EXISTS, 400 SYNONYM_TARGET_INVALID. */
export const createSynonym = (input: SearchSynonymInput) => api.post<SearchSynonym>('/admin/search/synonyms', input);

/** A patch naming the kind or a target field restates the whole target (kind + its one field). */
export const updateSynonym = (id: string, patch: Partial<SearchSynonymInput>) =>
  api.patch<SearchSynonym>(`/admin/search/synonyms/${id}`, patch);

export const deleteSynonym = (id: string) => api.delete<null>(`/admin/search/synonyms/${id}`);

/** What the query reader makes of `q` now (no cache, so a synonym just saved shows). */
export const previewSearch = (q: string) => api.post<QueryReading>('/admin/search/synonyms/preview', { q });

/** Top 50 searches of the last 30 days that found nothing. */
export const fetchZeroResults = () => api.get<ZeroResultRow[]>('/admin/search/zero-results');

/** Top 20 of the last 7 days, hidden ones included and marked. */
export const fetchTrending = () => api.get<TrendingRow[]>('/admin/search/trending');

export const hideTrending = (normalized: string) =>
  api.put<TrendingHiddenResult>(`/admin/search/trending-hidden/${encodeURIComponent(normalized)}`);

export const unhideTrending = (normalized: string) =>
  api.delete<TrendingHiddenResult>(`/admin/search/trending-hidden/${encodeURIComponent(normalized)}`);

// ─── copy ───

export const SYNONYM_EXISTS_MESSAGE = 'This term already points at that target';
export const TARGET_INVALID_MESSAGE = 'The target is turned off or no longer exists. Choose another one.';
export const CURSOR_RESET_MESSAGE = 'The list changed. It was reloaded from the top.';
export const SYNONYM_GONE_MESSAGE = 'This synonym no longer exists';

const ERROR_WORDS: Record<string, string> = {
  SYNONYM_EXISTS: SYNONYM_EXISTS_MESSAGE,
  SYNONYM_TARGET_INVALID: TARGET_INVALID_MESSAGE,
  CURSOR_INVALID: CURSOR_RESET_MESSAGE,
  NOT_FOUND: SYNONYM_GONE_MESSAGE,
};

/** A readable message for a search admin error: the known codes, else the API's message, else `fallback`. */
export function explainSearchError(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError && err.code && ERROR_WORDS[err.code]) return ERROR_WORDS[err.code];
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export const isApiCode = (err: unknown, code: string) => err instanceof ApiError && err.code === code;

export const TARGET_KIND_LABELS: Record<SynonymTarget, string> = {
  category: 'Category',
  brand: 'Brand',
  model: 'Model',
  side: 'Side',
  word: 'Words',
};

export const SCRIPT_LABELS: Record<SearchScript, string> = {
  latin: 'Latin',
  devanagari: 'Hindi',
  gujarati: 'Gujarati',
};

export const SEARCH_SIDE_LABELS: Record<SearchSide, string> = {
  left: 'Left',
  right: 'Right',
  pair: 'Pair',
};

export const READ_LEVEL_LABELS: Record<CatalogLevel, string> = {
  machine_category: 'Category',
  machine_type: 'Machine type',
  part_group: 'Part group',
};

/** A `YYYY-MM-DD` India day as "19 Nov 2026", read as a local date so no time zone moves it. */
export function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}
