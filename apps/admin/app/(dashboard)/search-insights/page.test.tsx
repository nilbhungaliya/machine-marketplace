import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('next/navigation', () => ({ usePathname: () => '/search-insights' }));
vi.mock('@/lib/search-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/search-api')>()),
  fetchZeroResults: vi.fn(),
  fetchTrending: vi.fn(),
  hideTrending: vi.fn(),
  unhideTrending: vi.fn(),
  createSynonym: vi.fn(),
}));
vi.mock('@/lib/catalog-api', () => ({ fetchAdminTree: vi.fn().mockResolvedValue([]), fetchAdminBrands: vi.fn().mockResolvedValue([]) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { createSynonym, fetchTrending, fetchZeroResults, hideTrending } from '@/lib/search-api';
import { synonym } from '@/components/search/test-fixtures';
import SearchInsightsPage from './page';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) { return this.parentElement; },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.style.overflow = '';
});

const renderPage = () => render(<ConfirmProvider><SearchInsightsPage /></ConfirmProvider>);

describe('SearchInsightsPage', () => {
  it('shows the zero-result and trending searches', async () => {
    vi.mocked(fetchZeroResults).mockResolvedValue([{ normalized: 'fendar', searches: 12, lastDay: '2026-11-19' }]);
    vi.mocked(fetchTrending).mockResolvedValue([{ normalized: 'bucket teeth', searches: 40, days: 6, hidden: false }]);
    renderPage();
    expect(await screen.findByText('fendar')).not.toBeNull();
    expect(await screen.findByText('bucket teeth')).not.toBeNull();
  });

  it('"Make a synonym" opens the add dialog with the term filled, and saving reloads', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchZeroResults).mockResolvedValue([{ normalized: 'fendar', searches: 12, lastDay: '2026-11-19' }]);
    vi.mocked(fetchTrending).mockResolvedValue([]);
    vi.mocked(createSynonym).mockResolvedValue(synonym({ id: 's1', term: 'fendar' }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Make a synonym of fendar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a synonym' });
    expect((within(dialog).getByLabelText('Term') as HTMLInputElement).value).toBe('fendar');
    await user.type(within(dialog).getByLabelText('Search for these words too'), 'fender');
    await user.click(within(dialog).getByRole('button', { name: 'Add synonym' }));
    await waitFor(() => expect(createSynonym).toHaveBeenCalledWith({ term: 'fendar', targetKind: 'word', targetWord: 'fender', isActive: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchZeroResults).toHaveBeenCalledTimes(2);
  });

  it('Hide refreshes the trending list', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchZeroResults).mockResolvedValue([]);
    vi.mocked(fetchTrending)
      .mockResolvedValueOnce([{ normalized: 'bucket teeth', searches: 40, days: 6, hidden: false }])
      .mockResolvedValueOnce([{ normalized: 'bucket teeth', searches: 40, days: 6, hidden: true }]);
    vi.mocked(hideTrending).mockResolvedValue({ normalized: 'bucket teeth', hidden: true });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Hide bucket teeth' }));
    expect(await screen.findByRole('button', { name: 'Unhide bucket teeth' })).not.toBeNull();
    expect(fetchTrending).toHaveBeenCalledTimes(2);
  });

  it('shows an error with a retry per list', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchZeroResults).mockRejectedValueOnce(new Error('Network down')).mockResolvedValue([]);
    vi.mocked(fetchTrending).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Network down')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Every search in the last 30 days found something')).not.toBeNull();
  });
});
