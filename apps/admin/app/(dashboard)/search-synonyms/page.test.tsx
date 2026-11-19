import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('next/navigation', () => ({ usePathname: () => '/search-synonyms' }));
vi.mock('@/lib/search-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/search-api')>()),
  fetchSynonyms: vi.fn(),
  previewSearch: vi.fn(),
  createSynonym: vi.fn(),
  updateSynonym: vi.fn(),
  deleteSynonym: vi.fn(),
}));
vi.mock('@/lib/catalog-api', () => ({ fetchAdminTree: vi.fn().mockResolvedValue([]), fetchAdminBrands: vi.fn().mockResolvedValue([]) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { fetchSynonyms } from '@/lib/search-api';
import { synonym } from '@/components/search/test-fixtures';
import SearchSynonymsPage from './page';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) { return this.parentElement; },
  });
});

beforeEach(() => window.history.replaceState(null, '', '/search-synonyms'));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.style.overflow = '';
});

const renderPage = () => render(<ConfirmProvider><SearchSynonymsPage /></ConfirmProvider>);

describe('SearchSynonymsPage', () => {
  it('lists the synonyms and filters by target kind through the URL', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchSynonyms).mockResolvedValue({ items: [synonym({ id: 's1', term: 'TRE', targetWord: 'tie rod end' })], nextCursor: null });
    renderPage();
    expect(await screen.findByText('TRE')).not.toBeNull();
    expect(fetchSynonyms).toHaveBeenCalledWith({ q: '', targetKind: '', cursor: null });

    await user.selectOptions(screen.getByLabelText('Target'), 'brand');
    await waitFor(() => expect(fetchSynonyms).toHaveBeenLastCalledWith({ q: '', targetKind: 'brand', cursor: null }));
    expect(window.location.search).toBe('?kind=brand');
  });

  it('shows the empty state with an Add button', async () => {
    vi.mocked(fetchSynonyms).mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText('No synonyms yet')).not.toBeNull();
  });

  it('loads more, and a CURSOR_INVALID reloads from the top', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchSynonyms)
      .mockResolvedValueOnce({ items: [synonym({ id: 's1', term: 'TRE' })], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [synonym({ id: 's2', term: 'brg' })], nextCursor: 'c2' })
      .mockRejectedValueOnce(new ApiError('This list has changed.', 400, 'CURSOR_INVALID'))
      .mockResolvedValueOnce({ items: [synonym({ id: 's1', term: 'TRE' })], nextCursor: null });
    renderPage();
    await screen.findByText('TRE');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('brg')).not.toBeNull();
    expect(screen.getByText('TRE')).not.toBeNull();
    expect(fetchSynonyms).toHaveBeenLastCalledWith({ q: '', targetKind: '', cursor: 'c1' });

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The list changed. It was reloaded from the top.'));
    await waitFor(() => expect(fetchSynonyms).toHaveBeenLastCalledWith({ q: '', targetKind: '', cursor: null }));
    await waitFor(() => expect(screen.queryByText('brg')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('drops an older reply when the filters change while it loads, and hides Load more meanwhile', async () => {
    const user = userEvent.setup();
    let resolveStale: (page: { items: ReturnType<typeof synonym>[]; nextCursor: string | null }) => void = () => {};
    vi.mocked(fetchSynonyms).mockImplementation(async ({ q, targetKind }) => {
      if (!q && !targetKind) return { items: [synonym({ id: 's1', term: 'TRE' })], nextCursor: 'c1' };
      if (q === 'x' && !targetKind) return new Promise((resolve) => { resolveStale = resolve; });
      return { items: [synonym({ id: 's2', term: 'brg' })], nextCursor: null };
    });
    renderPage();
    await screen.findByText('TRE');
    expect(screen.getByRole('button', { name: 'Load more' })).not.toBeNull();

    await user.type(screen.getByRole('searchbox', { name: 'Search synonyms' }), 'x');
    await waitFor(() => expect(fetchSynonyms).toHaveBeenLastCalledWith({ q: 'x', targetKind: '', cursor: null }));
    // The old rows stay, dimmed, with no Load more for the old filters' cursor.
    expect(screen.getByText('TRE').closest('tr')!.className).toContain('opacity-60');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Target'), 'brand');
    expect(await screen.findByText('brg')).not.toBeNull();
    resolveStale({ items: [synonym({ id: 's9', term: 'stale' })], nextCursor: null });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('stale')).toBeNull();
    expect(screen.getByText('brg')).not.toBeNull();
  });

  it('shows an error with a retry', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchSynonyms).mockRejectedValueOnce(new Error('Network down')).mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText('Network down')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No synonyms yet')).not.toBeNull();
  });

  it('opens the add dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchSynonyms).mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    await screen.findByText('No synonyms yet');
    await user.click(screen.getAllByRole('button', { name: 'Add synonym' })[0]);
    expect(await screen.findByRole('dialog', { name: 'Add a synonym' })).not.toBeNull();
  });
});
