import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryReading } from '@mpm/shared-types';

vi.mock('@/lib/search-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/search-api')>()),
  previewSearch: vi.fn(),
}));
import { ApiError } from '@/lib/api';
import { previewSearch } from '@/lib/search-api';
import { TrySearch } from './try-search';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const empty: QueryReading = { ref: null, brand: null, model: null, category: null, partNumbers: [], side: null, words: [], wordGroups: [] };

const chips = () => screen.getAllByRole('listitem').map((li) => li.textContent);

describe('TrySearch', () => {
  it("shows the reader's chips and words for what is typed", async () => {
    const user = userEvent.setup();
    vi.mocked(previewSearch).mockResolvedValue({
      ...empty,
      ref: 100123,
      brand: { id: 'b1', name: 'JCB' },
      model: { id: 'm1', name: '3DX', brandId: 'b1' },
      category: { id: 'c1', name: 'Gears', level: 'part_group' },
      partNumbers: ['6204zz'],
      side: 'left',
      words: ['bush'],
      wordGroups: [{ typed: ['fender'], alternatives: [['mudguard'], ['wing']] }],
    });
    render(<TrySearch />);
    await user.type(screen.getByRole('searchbox', { name: 'Try a search' }), 'jcb 3dx gears 6204zz lh bush fender');
    await waitFor(() => expect(previewSearch).toHaveBeenCalledWith('jcb 3dx gears 6204zz lh bush fender'));
    expect(previewSearch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(chips()).toEqual([
      'Listing #100123',
      'Brand JCB',
      'Model 3DX',
      'Part group Gears',
      'Part number 6204zz',
      'Side Left',
      'Word bush',
      'Words fender or mudguard or wing',
    ]));
  });

  it('says when nothing is left to search for', async () => {
    const user = userEvent.setup();
    vi.mocked(previewSearch).mockResolvedValue(empty);
    render(<TrySearch />);
    await user.type(screen.getByRole('searchbox', { name: 'Try a search' }), 'the');
    expect(await screen.findByText('Nothing to search for: only stop words.')).not.toBeNull();
  });

  it('does not call the API for a blank box, and shows an error', async () => {
    const user = userEvent.setup();
    vi.mocked(previewSearch).mockRejectedValue(new ApiError('Too many requests', 429, 'RATE_LIMITED'));
    render(<TrySearch />);
    await user.type(screen.getByRole('searchbox', { name: 'Try a search' }), '   ');
    await new Promise((r) => setTimeout(r, 400));
    expect(previewSearch).not.toHaveBeenCalled();
    await user.type(screen.getByRole('searchbox', { name: 'Try a search' }), 'gear');
    expect(await screen.findByText('Too many requests')).not.toBeNull();
  });

  it('reads again when the synonyms change', async () => {
    const user = userEvent.setup();
    vi.mocked(previewSearch).mockResolvedValue(empty);
    const { rerender } = render(<TrySearch refreshKey={0} />);
    await user.type(screen.getByRole('searchbox', { name: 'Try a search' }), 'gear');
    await waitFor(() => expect(previewSearch).toHaveBeenCalledTimes(1));
    rerender(<TrySearch refreshKey={1} />);
    await waitFor(() => expect(previewSearch).toHaveBeenCalledTimes(2));
  });

  it('an older, slower reply never replaces a newer one', async () => {
    const user = userEvent.setup();
    vi.mocked(previewSearch).mockImplementation((q: string) => new Promise((resolve) => {
      setTimeout(() => resolve({ ...empty, words: [q] }), q === 'a' ? 700 : 0);
    }));
    render(<TrySearch />);
    const box = screen.getByRole('searchbox', { name: 'Try a search' });
    await user.type(box, 'a');
    await waitFor(() => expect(previewSearch).toHaveBeenCalledWith('a'));
    await user.type(box, 'b');
    await waitFor(() => expect(chips()).toEqual(['Word ab']));
    await new Promise((r) => setTimeout(r, 800));
    expect(chips()).toEqual(['Word ab']);
  });

  it('caps the box at 200 characters', () => {
    render(<TrySearch />);
    expect(screen.getByRole('searchbox', { name: 'Try a search' }).getAttribute('maxlength')).toBe('200');
  });
});
