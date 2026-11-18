import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Unit } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ApiError } from '@/lib/api';
import { KeyedListEditor, unitDecimalsColumn, unitDecimalsExtras, unitMachineSwitch, type KeyedItem } from './keyed-list-editor';

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

const conditions: KeyedItem[] = [
  { id: 'c1', key: 'new', label: 'New', description: 'Never used, in original packing', isActive: true },
  { id: 'c2', key: 'excess', label: 'Excess', description: null, isActive: false },
  { id: 'c3', key: 'used', label: 'Used', description: null, isActive: true },
];

function renderEditor(over: Partial<{ onReorder: (ids: string[]) => Promise<void> }> = {}) {
  const handlers = {
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onReorder: vi.fn().mockResolvedValue(undefined),
    onReload: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  render(
    <ConfirmProvider>
      <KeyedListEditor noun="condition" items={conditions} withDescription {...handlers} />
    </ConfirmProvider>,
  );
  return handlers;
}

const rows = () => screen.getAllByRole('row').slice(1); // minus the header

describe('KeyedListEditor', () => {
  it('renders the items in the order given', () => {
    renderEditor();
    expect(rows().map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['New', 'ExcessOff', 'Used']);
  });

  it('marks an inactive item "Off"', () => {
    renderEditor();
    expect(within(rows()[1]).getByText('Off')).not.toBeNull();
    expect(within(rows()[0]).queryByText('Off')).toBeNull();
  });

  it('shows the description column', () => {
    renderEditor();
    expect(within(rows()[0]).getByText('Never used, in original packing')).not.toBeNull();
  });

  it('the edit dialog shows the key as read-only text', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor();
    await user.click(within(rows()[0]).getByRole('button', { name: 'Edit New' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit condition' });
    expect(within(dialog).queryByLabelText('Key')).toBeNull();
    expect(within(dialog).getByText('new')).not.toBeNull();
    const label = within(dialog).getByLabelText('Label');
    await user.clear(label);
    await user.type(label, 'Brand new');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onUpdate).toHaveBeenCalledWith(conditions[0], { label: 'Brand new' });
  });

  it('the create dialog rejects "Bad Key"', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    const dialog = screen.getByRole('dialog', { name: 'Add condition' });
    await user.type(within(dialog).getByLabelText('Label'), 'Bad');
    await user.clear(within(dialog).getByLabelText('Key'));
    await user.type(within(dialog).getByLabelText('Key'), 'Bad Key');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText(/snake_case/i)).not.toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('shows KEY_TAKEN under the key', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(new ApiError('taken', 409, 'KEY_TAKEN'));
    render(
      <ConfirmProvider>
        <KeyedListEditor noun="condition" items={conditions} onCreate={onCreate} onUpdate={vi.fn()} onReorder={vi.fn()} />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    const dialog = screen.getByRole('dialog', { name: 'Add condition' });
    await user.type(within(dialog).getByLabelText('Label'), 'Refurbished');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText('This key is already in use')).not.toBeNull();
  });

  it('move down sends every id in the new order', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Move New down' }));
    expect(onReorder).toHaveBeenCalledWith(['c2', 'c1', 'c3']);
  });

  it('the active switch turns an item on', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor();
    await user.click(within(rows()[1]).getByRole('switch'));
    expect(onUpdate).toHaveBeenCalledWith(conditions[1], { isActive: true });
  });

  it('on STALE_ORDER, reloads the list', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn().mockRejectedValue(new ApiError('The list has changed', 409, 'STALE_ORDER'));
    const { onReload } = renderEditor({ onReorder });
    await user.click(screen.getByRole('button', { name: 'Move New down' }));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
  });

  it('keeps the reorder buttons disabled until the reorder (and its reload) has finished', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onReorder = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    renderEditor({ onReorder });
    await user.click(screen.getByRole('button', { name: 'Move New down' }));
    const up = screen.getByRole('button', { name: 'Move Used up' }) as HTMLButtonElement;
    expect(up.disabled).toBe(true);
    await act(async () => { finish(); });
    expect(up.disabled).toBe(false);
  });
});

describe('KeyedListEditor for units', () => {
  const units: Unit[] = [
    { id: 'u1', key: 'pcs', label: 'Pieces', decimals: 0, sortOrder: 0, isActive: true },
    { id: 'u2', key: 'kg', label: 'Kilograms', decimals: 3, sortOrder: 1, isActive: true },
  ];

  function renderUnits() {
    const handlers = { onCreate: vi.fn().mockResolvedValue(undefined), onUpdate: vi.fn().mockResolvedValue(undefined), onReorder: vi.fn() };
    render(
      <ConfirmProvider>
        <KeyedListEditor<Unit, number>
          noun="unit"
          items={units}
          extraColumns={[unitDecimalsColumn]}
          extras={unitDecimalsExtras}
          {...handlers}
        />
      </ConfirmProvider>,
    );
    return handlers;
  }

  it('shows a Decimals column', () => {
    renderUnits();
    expect(screen.getByRole('columnheader', { name: 'Decimals' })).not.toBeNull();
    const decimals = rows().map((r) => within(r).getAllByRole('cell')[2].textContent);
    expect(decimals).toEqual(['0', '3']);
  });

  it('creates a unit with its decimals (0–3)', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderUnits();
    await user.click(screen.getByRole('button', { name: 'Add unit' }));
    const dialog = screen.getByRole('dialog', { name: 'Add unit' });
    const select = within(dialog).getByLabelText('Decimals');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['0', '1', '2', '3']);
    await user.type(within(dialog).getByLabelText('Label'), 'Metres');
    await user.selectOptions(select, '2');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(onCreate).toHaveBeenCalledWith({ key: 'metres', label: 'Metres', description: null, extra: 2 });
  });

  it('edits only the decimals when only they changed', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderUnits();
    await user.click(within(rows()[1]).getByRole('button', { name: 'Edit Kilograms' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit unit' });
    await user.selectOptions(within(dialog).getByLabelText('Decimals'), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onUpdate).toHaveBeenCalledWith(units[1], { extra: 1 });
  });

  it('the Machine unit switch sends isMachineUnit for that unit (F2 spec §4.2, R48)', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const flagged: Unit[] = [{ ...units[0], isMachineUnit: false }, { ...units[1], key: 'machines', label: 'Machines', isMachineUnit: true }];
    render(
      <ConfirmProvider>
        <KeyedListEditor<Unit, number>
          noun="unit"
          items={flagged}
          extraColumns={[unitDecimalsColumn]}
          extras={unitDecimalsExtras}
          switches={[unitMachineSwitch(onToggle)]}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onReorder={vi.fn()}
        />
      </ConfirmProvider>,
    );
    expect(screen.getByRole('columnheader', { name: 'Machine unit' })).not.toBeNull();
    const on = screen.getByRole('switch', { name: 'Machines machine unit' });
    expect(on.getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('switch', { name: 'Pieces machine unit' }));
    expect(onToggle).toHaveBeenCalledWith(flagged[0], true);
  });
});
