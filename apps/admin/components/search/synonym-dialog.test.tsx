import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/search-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/search-api')>()),
  createSynonym: vi.fn(),
  updateSynonym: vi.fn(),
}));
vi.mock('@/lib/catalog-api', () => ({ fetchAdminTree: vi.fn(), fetchAdminBrands: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { fetchAdminBrands, fetchAdminTree } from '@/lib/catalog-api';
import { createSynonym, updateSynonym } from '@/lib/search-api';
import { SynonymDialog } from './synonym-dialog';
import { brands, synonym, tree } from './test-fixtures';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) { return this.parentElement; },
  });
});

beforeEach(() => {
  vi.mocked(fetchAdminTree).mockResolvedValue(tree);
  vi.mocked(fetchAdminBrands).mockResolvedValue(brands);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.style.overflow = '';
});

const GEARS = '33333333-3333-4333-8333-333333333333';
const JCB = '55555555-5555-4555-8555-555555555555';
const DX = '66666666-6666-4666-8666-666666666666';

function open(props: Partial<Parameters<typeof SynonymDialog>[0]> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<ConfirmProvider><SynonymDialog onClose={onClose} onSaved={onSaved} {...props} /></ConfirmProvider>);
  return { onSaved, onClose };
}

const submit = (user: ReturnType<typeof userEvent.setup>, name = 'Add synonym') => user.click(screen.getByRole('button', { name }));

describe('SynonymDialog: add', () => {
  it('words: sends the term and the words to search for', async () => {
    const user = userEvent.setup();
    vi.mocked(createSynonym).mockResolvedValue(synonym({ id: 's1', term: 'TRE' }));
    const { onSaved } = open();
    await user.type(screen.getByLabelText('Term'), 'TRE');
    await user.click(screen.getByRole('radio', { name: 'Words' }));
    await user.type(screen.getByLabelText('Search for these words too'), 'tie rod end');
    await submit(user);
    expect(createSynonym).toHaveBeenCalledWith({ term: 'TRE', targetKind: 'word', targetWord: 'tie rod end', isActive: true });
    expect(toast.success).toHaveBeenCalledWith('Synonym added');
    expect(onSaved).toHaveBeenCalled();
  });

  it('checks the term and the target of each kind', async () => {
    const user = userEvent.setup();
    open();
    await submit(user);
    expect(await screen.findByText('Type the term buyers search for')).not.toBeNull();

    await user.type(screen.getByLabelText('Term'), 'one two three four five');
    await submit(user);
    expect(await screen.findByText('At most 4 words')).not.toBeNull();
    await user.clear(screen.getByLabelText('Term'));
    await user.type(screen.getByLabelText('Term'), 'gearz');

    const cases: Array<[string, string]> = [
      ['Words', 'Type the words to search for'],
      ['Category', 'Choose a category'],
      ['Brand', 'Choose a brand'],
      ['Model', 'Choose a model'],
      ['Side', 'Choose left, right or pair'],
    ];
    for (const [kind, message] of cases) {
      await user.click(screen.getByRole('radio', { name: kind }));
      await submit(user);
      expect(await screen.findByText(message), kind).not.toBeNull();
    }
    expect(createSynonym).not.toHaveBeenCalled();
  });

  it('category: picks from the tree by path, active nodes only', async () => {
    const user = userEvent.setup();
    vi.mocked(createSynonym).mockResolvedValue(synonym({ id: 's1', term: 'gearz' }));
    open();
    await user.type(screen.getByLabelText('Term'), 'gearz');
    await user.click(screen.getByRole('radio', { name: 'Category' }));
    const select = await screen.findByLabelText('Target category');
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
    const labels = within(select).getAllByRole('option').slice(1).map((o) => o.textContent);
    expect(labels).toEqual(['Construction', 'Construction › Backhoe Loader', 'Construction › Backhoe Loader › Gears']);
    await user.selectOptions(select, GEARS);
    await submit(user);
    expect(createSynonym).toHaveBeenCalledWith({ term: 'gearz', targetKind: 'category', targetId: GEARS, isActive: true });
  });

  it('brand and model: active brands, models as Brand › Model', async () => {
    const user = userEvent.setup();
    vi.mocked(createSynonym).mockResolvedValue(synonym({ id: 's1', term: 'x' }));
    open();
    await user.type(screen.getByLabelText('Term'), 'jaysee');
    await user.click(screen.getByRole('radio', { name: 'Brand' }));
    const brand = await screen.findByLabelText('Target brand');
    await waitFor(() => expect(within(brand).getAllByRole('option').slice(1).map((o) => o.textContent)).toEqual(['JCB']));
    await user.click(screen.getByRole('radio', { name: 'Model' }));
    const model = await screen.findByLabelText('Target model');
    expect(within(model).getAllByRole('option').slice(1).map((o) => o.textContent)).toEqual(['JCB › 3DX']);
    await user.selectOptions(model, DX);
    await submit(user);
    expect(createSynonym).toHaveBeenCalledWith({ term: 'jaysee', targetKind: 'model', targetId: DX, isActive: true });
  });

  it('side: sends the side', async () => {
    const user = userEvent.setup();
    vi.mocked(createSynonym).mockResolvedValue(synonym({ id: 's1', term: 'rh' }));
    open();
    await user.type(screen.getByLabelText('Term'), 'r.h.');
    await user.click(screen.getByRole('radio', { name: 'Side' }));
    await user.click(screen.getByRole('radio', { name: 'Right' }));
    await submit(user);
    expect(createSynonym).toHaveBeenCalledWith({ term: 'r.h.', targetKind: 'side', targetSide: 'right', isActive: true });
  });

  it('starts from a given term (Make a synonym)', () => {
    open({ initialTerm: 'fendar' });
    expect((screen.getByLabelText('Term') as HTMLInputElement).value).toBe('fendar');
  });

  it('shows SYNONYM_EXISTS under the term and SYNONYM_TARGET_INVALID under the target', async () => {
    const user = userEvent.setup();
    vi.mocked(createSynonym)
      .mockRejectedValueOnce(new ApiError('exists', 409, 'SYNONYM_EXISTS'))
      .mockRejectedValueOnce(new ApiError('Choose an active brand', 400, 'SYNONYM_TARGET_INVALID'));
    const { onSaved } = open();
    await user.type(screen.getByLabelText('Term'), 'jaysee');
    await user.click(screen.getByRole('radio', { name: 'Brand' }));
    const brand = await screen.findByLabelText('Target brand');
    await waitFor(() => expect(within(brand).getAllByRole('option').length).toBe(2));
    await user.selectOptions(brand, JCB);
    await submit(user);
    expect(await screen.findByText('This term already points at that target')).not.toBeNull();
    await submit(user);
    expect(await screen.findByText('The target is turned off or no longer exists. Choose another one.')).not.toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('a side or words refusal shows the API message under the target', async () => {
    const user = userEvent.setup();
    vi.mocked(createSynonym).mockRejectedValueOnce(new ApiError('Type the words to search for', 400, 'SYNONYM_TARGET_INVALID'));
    open();
    await user.type(screen.getByLabelText('Term'), 'tre');
    await user.type(screen.getByLabelText('Search for these words too'), '...');
    await submit(user);
    const error = await screen.findByText('Type the words to search for');
    expect(error.id).toBe('synonym-word-error');
  });

  it('counts words without the joiners Indic keyboards insert (as the API normaliser)', async () => {
    const user = userEvent.setup();
    vi.mocked(createSynonym).mockResolvedValue(synonym({ id: 's1', term: 'x' }));
    open();
    const zwnj = String.fromCharCode(0x200c);
    const term = `लेफ${zwnj}्ट हैंड साइड पार्ट`;
    await user.type(screen.getByLabelText('Term'), term);
    await user.type(screen.getByLabelText('Search for these words too'), 'left');
    await submit(user);
    expect(createSynonym).toHaveBeenCalledWith({ term, targetKind: 'word', targetWord: 'left', isActive: true });
  });

  it('shows a term the API refuses under the term', async () => {
    const user = userEvent.setup();
    vi.mocked(createSynonym).mockRejectedValueOnce(new ApiError('Type a word to match', 400, 'VALIDATION_ERROR'));
    open();
    await user.type(screen.getByLabelText('Term'), '---');
    await user.click(screen.getByRole('radio', { name: 'Words' }));
    await user.type(screen.getByLabelText('Search for these words too'), 'dash');
    await submit(user);
    expect(await screen.findByText('Type a word to match')).not.toBeNull();
  });
});

describe('SynonymDialog: edit', () => {
  const tre = synonym({ id: 's1', term: 'TRE', targetKind: 'word', targetWord: 'tie rod end' });

  it('sends only what changed', async () => {
    const user = userEvent.setup();
    vi.mocked(updateSynonym).mockResolvedValue({ ...tre, isActive: false });
    const { onSaved } = open({ synonym: tre });
    expect((screen.getByLabelText('Search for these words too') as HTMLInputElement).value).toBe('tie rod end');
    await user.click(screen.getByRole('checkbox', { name: /Active/ }));
    await submit(user, 'Save');
    expect(updateSynonym).toHaveBeenCalledWith('s1', { isActive: false });
    expect(toast.success).toHaveBeenCalledWith('Synonym saved');
    expect(onSaved).toHaveBeenCalled();
  });

  it('a new target restates the kind and its field', async () => {
    const user = userEvent.setup();
    vi.mocked(updateSynonym).mockResolvedValue(tre);
    open({ synonym: tre });
    await user.click(screen.getByRole('radio', { name: 'Side' }));
    await user.click(screen.getByRole('radio', { name: 'Left' }));
    await submit(user, 'Save');
    expect(updateSynonym).toHaveBeenCalledWith('s1', { targetKind: 'side', targetSide: 'left' });
  });

  const RETIRED = '77777777-7777-4777-8777-777777777777';
  const offBrand = synonym({ id: 's2', term: 'retco', targetKind: 'brand', targetId: RETIRED, targetName: 'Retired Co' });

  it('a target turned off since: shown as off, and a term-only change sends no target', async () => {
    const user = userEvent.setup();
    vi.mocked(updateSynonym).mockResolvedValue(offBrand);
    open({ synonym: offBrand });
    const brand = await screen.findByLabelText('Target brand');
    await waitFor(() => expect(within(brand).getAllByRole('option').map((o) => o.textContent)).toContain('Retired Co (off)'));
    expect((brand as HTMLSelectElement).value).toBe(RETIRED);
    await user.clear(screen.getByLabelText('Term'));
    await user.type(screen.getByLabelText('Term'), 'ret co');
    await submit(user, 'Save');
    expect(updateSynonym).toHaveBeenCalledWith('s2', { term: 'ret co' });
  });

  it('another target of the same kind sends the kind and the new id', async () => {
    const user = userEvent.setup();
    vi.mocked(updateSynonym).mockResolvedValue(offBrand);
    open({ synonym: offBrand });
    const brand = await screen.findByLabelText('Target brand');
    await waitFor(() => expect(within(brand).getAllByRole('option').length).toBe(3));
    await user.selectOptions(brand, JCB);
    await submit(user, 'Save');
    expect(updateSynonym).toHaveBeenCalledWith('s2', { targetKind: 'brand', targetId: JCB });
  });

  it('nothing changed: closes without a call', async () => {
    const user = userEvent.setup();
    const { onClose } = open({ synonym: tre });
    await submit(user, 'Save');
    expect(updateSynonym).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('a synonym deleted meanwhile: says so and reloads', async () => {
    const user = userEvent.setup();
    vi.mocked(updateSynonym).mockRejectedValue(new ApiError('Synonym not found', 404, 'NOT_FOUND'));
    const { onSaved } = open({ synonym: tre });
    await user.clear(screen.getByLabelText('Term'));
    await user.type(screen.getByLabelText('Term'), 'T.R.E.');
    await submit(user, 'Save');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This synonym no longer exists'));
    expect(onSaved).toHaveBeenCalled();
  });
});
