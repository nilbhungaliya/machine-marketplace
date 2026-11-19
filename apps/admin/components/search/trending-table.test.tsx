import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TrendingRow } from '@mpm/shared-types';

vi.mock('@/lib/search-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/search-api')>()),
  hideTrending: vi.fn(),
  unhideTrending: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { hideTrending, unhideTrending } from '@/lib/search-api';
import { TrendingTable } from './trending-table';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const rows: TrendingRow[] = [
  { normalized: 'jcb 3dx bucket teeth', searches: 40, days: 6, hidden: false },
  { normalized: 'cheap spam', searches: 9, days: 3, hidden: true },
];

const rowOf = (text: string) => screen.getByText(text).closest('tr')!;

describe('TrendingTable', () => {
  it('lists the searches with counts, distinct days and hidden ones marked', () => {
    render(<TrendingTable rows={rows} onChanged={() => {}} />);
    const shown = rowOf('jcb 3dx bucket teeth');
    expect(within(shown).getByText('40')).not.toBeNull();
    expect(within(shown).getByText('6')).not.toBeNull();
    expect(within(shown).queryByText('Hidden')).toBeNull();
    expect(within(rowOf('cheap spam')).getByText('Hidden')).not.toBeNull();
  });

  it('hides a search and refreshes', async () => {
    const user = userEvent.setup();
    vi.mocked(hideTrending).mockResolvedValue({ normalized: 'jcb 3dx bucket teeth', hidden: true });
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<TrendingTable rows={rows} onChanged={onChanged} />);
    await user.click(within(rowOf('jcb 3dx bucket teeth')).getByRole('button', { name: 'Hide jcb 3dx bucket teeth' }));
    await waitFor(() => expect(hideTrending).toHaveBeenCalledWith('jcb 3dx bucket teeth'));
    expect(toast.success).toHaveBeenCalledWith('Hidden from trending in the app');
    expect(onChanged).toHaveBeenCalled();
  });

  it('unhides a search and refreshes', async () => {
    const user = userEvent.setup();
    vi.mocked(unhideTrending).mockResolvedValue({ normalized: 'cheap spam', hidden: false });
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<TrendingTable rows={rows} onChanged={onChanged} />);
    await user.click(within(rowOf('cheap spam')).getByRole('button', { name: 'Unhide cheap spam' }));
    await waitFor(() => expect(unhideTrending).toHaveBeenCalledWith('cheap spam'));
    expect(toast.success).toHaveBeenCalledWith('Shown in trending again');
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows an error toast when the call fails', async () => {
    const user = userEvent.setup();
    vi.mocked(hideTrending).mockRejectedValue(new ApiError('Name a search', 400, 'VALIDATION_ERROR'));
    const onChanged = vi.fn();
    render(<TrendingTable rows={rows} onChanged={onChanged} />);
    await user.click(within(rowOf('jcb 3dx bucket teeth')).getByRole('button', { name: 'Hide jcb 3dx bucket teeth' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Name a search'));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
