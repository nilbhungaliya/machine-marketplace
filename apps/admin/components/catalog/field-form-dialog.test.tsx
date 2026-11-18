import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CatalogLevel, TemplateField } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/catalog-api', () => ({
  createField: vi.fn(),
  updateField: vi.fn(),
  createOption: vi.fn(),
  updateOption: vi.fn(),
  reorderOptions: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { createField, updateField } from '@/lib/catalog-api';
import { ApiError } from '@/lib/api';
import { FieldFormDialog } from './field-form-dialog';

// jsdom has no layout, so offsetParent is always null (see dialog.test.tsx).
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

const textField: TemplateField = {
  id: 'f1', categoryId: 'c1', key: 'finish', label: 'Finish', helpText: null, type: 'text', appliesTo: 'parts', unit: null,
  min: null, max: null, required: false, filterable: false, highlightRank: null, sortOrder: 0, status: 'active', options: [],
};

const renderCreate = (nodeLevel: CatalogLevel = 'machine_type') => {
  const onSaved = vi.fn();
  render(
    <ConfirmProvider>
      <FieldFormDialog mode="create" categoryId="c1" nodeLevel={nodeLevel} onClose={() => {}} onSaved={onSaved} />
    </ConfirmProvider>,
  );
  return { onSaved };
};

const optionLabels = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent);

describe('FieldFormDialog', () => {
  it('create: unit, min and max appear only once the type is number', async () => {
    const user = userEvent.setup();
    renderCreate();
    expect(screen.queryByLabelText('Unit')).toBeNull();
    expect(screen.queryByLabelText('Min')).toBeNull();
    expect(screen.queryByLabelText('Max')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Type'), 'number');
    expect(screen.getByLabelText('Unit')).not.toBeNull();
    expect(screen.getByLabelText('Min')).not.toBeNull();
    expect(screen.getByLabelText('Max')).not.toBeNull();
  });

  it('create: the key follows the label as snake_case', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText('Label'), 'Needle Size (mm)');
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('needle_size_mm');
  });

  it('create: applies to Parts, Machines or Both on a category or machine type', () => {
    renderCreate('machine_type');
    expect(optionLabels(screen.getByLabelText('Applies to'))).toEqual(['Parts', 'Machines', 'Both']);
  });

  it('create: on a part group the applies-to select has no "Machines"', () => {
    renderCreate('part_group');
    expect(optionLabels(screen.getByLabelText('Applies to'))).toEqual(['Parts', 'Both']);
  });

  it('create: an invalid key shows a message and does not submit', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText('Label'), 'Weight');
    await user.clear(screen.getByLabelText('Key'));
    await user.type(screen.getByLabelText('Key'), 'Bad Key');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    expect(await screen.findByText(/snake_case/i)).not.toBeNull();
    expect(createField).not.toHaveBeenCalled();
  });

  it('create: sends the field with applies-to and shows KEY_TAKEN under the key', async () => {
    const user = userEvent.setup();
    vi.mocked(createField).mockRejectedValueOnce(new ApiError('taken', 409, 'KEY_TAKEN'));
    const { onSaved } = renderCreate();
    await user.type(screen.getByLabelText('Label'), 'Heads');
    await user.selectOptions(screen.getByLabelText('Type'), 'number');
    await user.selectOptions(screen.getByLabelText('Applies to'), 'machines');
    await user.selectOptions(screen.getByLabelText('Highlight rank'), '2');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    expect(createField).toHaveBeenCalledWith('c1', expect.objectContaining({
      key: 'heads', label: 'Heads', type: 'number', appliesTo: 'machines', highlightRank: 2, required: false, filterable: false,
    }));
    expect(await screen.findByText(/already used/i)).not.toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('create: shows RANK_TAKEN under the highlight rank', async () => {
    const user = userEvent.setup();
    vi.mocked(createField).mockRejectedValueOnce(new ApiError('taken', 409, 'RANK_TAKEN'));
    renderCreate();
    await user.type(screen.getByLabelText('Label'), 'Heads');
    await user.selectOptions(screen.getByLabelText('Highlight rank'), '1');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    expect(await screen.findByText('Rank 1 is already used in a template this field belongs to')).not.toBeNull();
  });

  it('edit: has no key, type or applies-to inputs, and sends only what changed', async () => {
    const user = userEvent.setup();
    vi.mocked(updateField).mockResolvedValueOnce({ ...textField, label: 'Surface finish' });
    const onSaved = vi.fn();
    render(
      <ConfirmProvider>
        <FieldFormDialog mode="edit" field={textField} onClose={() => {}} onSaved={onSaved} onOptionsChanged={() => {}} />
      </ConfirmProvider>,
    );
    expect(screen.queryByLabelText('Key')).toBeNull();
    expect(screen.queryByLabelText('Type')).toBeNull();
    expect(screen.queryByLabelText('Applies to')).toBeNull();
    expect(screen.getByText('finish')).not.toBeNull();
    expect(screen.getByText(/parts only/i)).not.toBeNull();
    const label = screen.getByLabelText('Label');
    await user.clear(label);
    await user.type(label, 'Surface finish');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateField).toHaveBeenCalledWith('f1', { label: 'Surface finish' });
    expect(onSaved).toHaveBeenCalled();
  });
});

describe('FieldFormDialog required-select warning', () => {
  const WARNING = 'Required, but no active options: sellers can skip it until one is added.';
  const selectField: TemplateField = { ...textField, type: 'single_select', required: true };
  const renderEdit = (field: TemplateField) =>
    render(
      <ConfirmProvider>
        <FieldFormDialog mode="edit" field={field} onClose={() => {}} onSaved={() => {}} onOptionsChanged={() => {}} />
      </ConfirmProvider>,
    );

  it('edit: shows on a required select with no active options', () => {
    renderEdit(selectField);
    expect(screen.getByText(WARNING)).not.toBeNull();
  });

  it('edit: gone once the select has an active option', () => {
    renderEdit({ ...selectField, options: [{ id: 'o1', key: 'rotary', label: 'Rotary', sortOrder: 0, status: 'active' }] });
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});
