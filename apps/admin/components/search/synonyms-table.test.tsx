import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/search-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/search-api')>()),
  deleteSynonym: vi.fn(),
  updateSynonym: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { deleteSynonym, updateSynonym } from '@/lib/search-api';
import { SynonymsTable, type SynonymsTableProps } from './synonyms-table';
import { synonym } from './test-fixtures';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.style.overflow = '';
});

const rows = [
  synonym({ id: 's1', term: 'TRE', targetKind: 'word', targetWord: 'tie rod end' }),
  synonym({ id: 's2', term: 'बायाँ', termNorm: 'बायाँ', script: 'devanagari', targetKind: 'side', targetSide: 'left' }),
  synonym({ id: 's3', term: 'Jaysee', targetKind: 'brand', targetId: 'b1', targetName: 'JCB', isActive: false }),
  synonym({ id: 's4', term: 'gearz', targetKind: 'category', targetId: 'c1', targetName: 'Construction › Backhoe Loader › Gears' }),
];

function setup(over: Partial<SynonymsTableProps> = {}) {
  const props: SynonymsTableProps = {
    rows, q: '', onQChange: vi.fn(), kind: '', onKindChange: vi.fn(), hasMore: false, loadingMore: false,
    onLoadMore: vi.fn(), onEdit: vi.fn(), onChanged: vi.fn().mockResolvedValue(undefined), ...over,
  };
  render(<ConfirmProvider><SynonymsTable {...props} /></ConfirmProvider>);
  return props;
}

const rowOf = (text: string) => screen.getByText(text).closest('tr')!;

describe('SynonymsTable', () => {
  it('shows each synonym with its script, target and state', () => {
    setup();
    expect(within(rowOf('TRE')).getByText('Latin')).not.toBeNull();
    expect(within(rowOf('TRE')).getByText('Words')).not.toBeNull();
    expect(within(rowOf('TRE')).getByText('tie rod end')).not.toBeNull();
    expect(within(rowOf('बायाँ')).getByText('Hindi')).not.toBeNull();
    expect(within(rowOf('बायाँ')).getByText('Left')).not.toBeNull();
    expect(within(rowOf('Jaysee')).getByText('JCB')).not.toBeNull();
    expect((within(rowOf('Jaysee')).getByRole('switch', { name: 'Jaysee active' })).getAttribute('aria-checked')).toBe('false');
    expect(within(rowOf('gearz')).getByText('Construction › Backhoe Loader › Gears')).not.toBeNull();
  });

  it('filters by target kind', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.selectOptions(screen.getByLabelText('Target'), 'brand');
    expect(props.onKindChange).toHaveBeenCalledWith('brand');
  });

  it('searches after a pause in typing', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search synonyms' }), 'tre');
    await waitFor(() => expect(props.onQChange).toHaveBeenCalledWith('tre'));
    expect(props.onQChange).toHaveBeenCalledTimes(1);
  });

  it('deletes after a confirm', async () => {
    const user = userEvent.setup();
    vi.mocked(deleteSynonym).mockResolvedValue(null);
    const props = setup();
    await user.click(within(rowOf('TRE')).getByRole('button', { name: 'Delete TRE' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete "TRE"?' });
    // The danger variant: the red outline button.
    expect(within(dialog).getByRole('button', { name: 'Delete' }).className).toContain('text-red-600');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteSynonym).toHaveBeenCalledWith('s1'));
    expect(toast.success).toHaveBeenCalledWith('Synonym deleted');
    expect(props.onChanged).toHaveBeenCalled();
  });

  it('keeps the synonym when the confirm is cancelled', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(within(rowOf('TRE')).getByRole('button', { name: 'Delete TRE' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete "TRE"?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(deleteSynonym).not.toHaveBeenCalled();
  });

  it('a delete of a synonym already gone says so and reloads', async () => {
    const user = userEvent.setup();
    vi.mocked(deleteSynonym).mockRejectedValue(new ApiError('Synonym not found', 404, 'NOT_FOUND'));
    const props = setup();
    await user.click(within(rowOf('TRE')).getByRole('button', { name: 'Delete TRE' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This synonym no longer exists'));
    expect(props.onChanged).toHaveBeenCalled();
  });

  it('turns a synonym on and off', async () => {
    const user = userEvent.setup();
    vi.mocked(updateSynonym).mockResolvedValue(rows[0]);
    const props = setup();
    await user.click(within(rowOf('TRE')).getByRole('switch', { name: 'TRE active' }));
    await waitFor(() => expect(updateSynonym).toHaveBeenCalledWith('s1', { isActive: false }));
    expect(props.onChanged).toHaveBeenCalled();
  });

  it('opens the edit dialog and loads more', async () => {
    const user = userEvent.setup();
    const props = setup({ hasMore: true });
    await user.click(within(rowOf('TRE')).getByRole('button', { name: 'Edit TRE' }));
    expect(props.onEdit).toHaveBeenCalledWith(rows[0]);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(props.onLoadMore).toHaveBeenCalled();
  });

  it('has no Load more on the last page', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});

describe('SynonymsTable: search box and reloads', () => {
  /** Holds `q` in state like the page's URL state: the committed value comes back trimmed. */
  function Host({ onQChange }: { onQChange: (q: string) => void }) {
    const [q, setQ] = useState('');
    return (
      <ConfirmProvider>
        <SynonymsTable
          rows={rows} q={q} onQChange={(next) => { onQChange(next); setQ(next); }} kind="" onKindChange={() => {}}
          hasMore={false} loadingMore={false} onLoadMore={() => {}} onEdit={() => {}} onChanged={() => {}}
        />
      </ConfirmProvider>
    );
  }

  it('keeps a trailing space typed before a pause', async () => {
    const user = userEvent.setup();
    const onQChange = vi.fn();
    render(<Host onQChange={onQChange} />);
    const box = screen.getByRole('searchbox', { name: 'Search synonyms' }) as HTMLInputElement;
    await user.type(box, 'tie ');
    await waitFor(() => expect(onQChange).toHaveBeenCalledWith('tie'));
    expect(box.value).toBe('tie ');
    await user.type(box, 'rod');
    expect(box.value).toBe('tie rod');
    await waitFor(() => expect(onQChange).toHaveBeenLastCalledWith('tie rod'));
  });

  it('dims the rows and hides Load more while new filters load', () => {
    setup({ hasMore: true, reloading: true });
    expect(rowOf('TRE').className).toContain('opacity-60');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('caps the search box at 100 characters', () => {
    setup();
    expect(screen.getByRole('searchbox', { name: 'Search synonyms' }).getAttribute('maxlength')).toBe('100');
  });
});
