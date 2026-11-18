import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/industrial-areas-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/industrial-areas-api')>()),
  adoptOtherValue: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { adoptOtherValue, type OtherValue } from '@/lib/industrial-areas-api';
import { OtherValues } from './other-values';

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

const rows: OtherValue[] = [
  { text: 'sachin gidc phase 2', district: 'Surat', state: 'Gujarat', count: 3, adoptable: true },
  { text: 'new estate', district: 'Nowhere', state: 'Gujarat', count: 1, adoptable: false },
];

function renderList() {
  const onAdopted = vi.fn();
  render(<ConfirmProvider><OtherValues rows={rows} onAdopted={onAdopted} /></ConfirmProvider>);
  return { onAdopted };
}

const row = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

describe('OtherValues', () => {
  it('Add to list posts { text, district, state, name } and shows the linked count', async () => {
    const user = userEvent.setup();
    vi.mocked(adoptOtherValue).mockResolvedValue({ areaId: 'ia9', linked: 3 });
    const { onAdopted } = renderList();

    await user.click(within(row('sachin gidc phase 2')).getByRole('button', { name: 'Add to list' }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByLabelText('Area name') as HTMLInputElement;
    expect(name.value).toBe('Sachin Gidc Phase 2');
    await user.clear(name);
    await user.type(name, 'Sachin GIDC Phase 2');
    await user.click(within(dialog).getByRole('button', { name: 'Add to list' }));

    expect(adoptOtherValue).toHaveBeenCalledWith({
      text: 'sachin gidc phase 2', district: 'Surat', state: 'Gujarat', name: 'Sachin GIDC Phase 2',
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Added and linked 3 businesses'));
    expect(onAdopted).toHaveBeenCalled();
  });

  it("a row with an unknown pincode says it can't be linked and has no Add to list button", () => {
    renderList();
    const unknown = row('new estate');
    expect(within(unknown).queryByRole('button', { name: 'Add to list' })).toBeNull();
    expect(within(unknown).getByText("Unknown pincode — can't be linked")).not.toBeNull();
  });

  it('shows how many businesses typed each text', () => {
    renderList();
    expect(within(row('sachin gidc phase 2')).getByText('3')).not.toBeNull();
  });
});
