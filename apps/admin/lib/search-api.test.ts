import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(), download: vi.fn() },
}));
import { api, ApiError } from './api';
import {
  createSynonym, deleteSynonym, explainSearchError, fetchSynonyms, fetchTrending, fetchZeroResults, formatDay, hideTrending,
  previewSearch, synonymsQuery, unhideTrending, updateSynonym,
} from './search-api';

afterEach(() => { vi.clearAllMocks(); });

describe('synonymsQuery', () => {
  it('writes only the values that are set', () => {
    expect(synonymsQuery({ q: ' tre ', targetKind: 'word', cursor: 'abc' })).toBe('q=tre&targetKind=word&cursor=abc');
    expect(synonymsQuery({ q: '', targetKind: '', cursor: null })).toBe('');
    expect(synonymsQuery({})).toBe('');
  });
});

describe('calls', () => {
  it('lists synonyms with the filters', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [], nextCursor: null });
    await fetchSynonyms({ targetKind: 'brand' });
    expect(api.get).toHaveBeenCalledWith('/admin/search/synonyms?targetKind=brand');
    await fetchSynonyms({});
    expect(api.get).toHaveBeenLastCalledWith('/admin/search/synonyms');
  });

  it('creates, updates and deletes a synonym', async () => {
    await createSynonym({ term: 'TRE', targetKind: 'word', targetWord: 'tie rod end' });
    expect(api.post).toHaveBeenCalledWith('/admin/search/synonyms', { term: 'TRE', targetKind: 'word', targetWord: 'tie rod end' });
    await updateSynonym('s1', { isActive: false });
    expect(api.patch).toHaveBeenCalledWith('/admin/search/synonyms/s1', { isActive: false });
    await deleteSynonym('s1');
    expect(api.delete).toHaveBeenCalledWith('/admin/search/synonyms/s1');
  });

  it('previews a search', async () => {
    await previewSearch('bull gear');
    expect(api.post).toHaveBeenCalledWith('/admin/search/synonyms/preview', { q: 'bull gear' });
  });

  it('reads the insights and hides / unhides a trending search by its encoded text', async () => {
    await fetchZeroResults();
    expect(api.get).toHaveBeenCalledWith('/admin/search/zero-results');
    await fetchTrending();
    expect(api.get).toHaveBeenLastCalledWith('/admin/search/trending');
    await hideTrending('tie rod end');
    expect(api.put).toHaveBeenCalledWith('/admin/search/trending-hidden/tie%20rod%20end');
    await unhideTrending('गियर');
    expect(api.delete).toHaveBeenCalledWith(`/admin/search/trending-hidden/${encodeURIComponent('गियर')}`);
  });
});

describe('explainSearchError', () => {
  it('turns the search codes into readable messages', () => {
    expect(explainSearchError(new ApiError('x', 409, 'SYNONYM_EXISTS'))).toBe('This term already points at that target');
    expect(explainSearchError(new ApiError('x', 400, 'SYNONYM_TARGET_INVALID'))).toBe(
      'The target is turned off or no longer exists. Choose another one.',
    );
    expect(explainSearchError(new ApiError('x', 400, 'CURSOR_INVALID'))).toBe('The list changed. It was reloaded from the top.');
    expect(explainSearchError(new ApiError('x', 404, 'NOT_FOUND'))).toBe('This synonym no longer exists');
  });

  it('falls back to the API message, then to the fallback', () => {
    expect(explainSearchError(new ApiError('A synonym has at most 4 words', 400, 'VALIDATION_ERROR'))).toBe('A synonym has at most 4 words');
    expect(explainSearchError('nope', 'Could not save')).toBe('Could not save');
  });
});

describe('formatDay', () => {
  it('shows an India day without moving it across time zones', () => {
    expect(formatDay('2026-11-19')).toBe('19 Nov 2026');
    expect(formatDay('bad')).toBe('bad');
  });
});
