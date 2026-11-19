import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Brand } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/catalog-api', () => ({ createBrand: vi.fn(), updateBrand: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { createBrand, updateBrand } from '@/lib/catalog-api';
import { BrandFormDialog } from './brand-form-dialog';

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

const bull: Brand = {
  id: 'b1', key: 'bull', name: 'Bull', slug: 'bull', makesMachines: true, makesParts: false,
  needsReview: false, sortOrder: 0, isActive: true, chipNeedsContext: false,
};

const LABEL = /Read as a brand chip only with one of its models or a machine type/;

describe('BrandFormDialog: chip needs context (F4 + F5 §4.1)', () => {
  it('explains the flag', () => {
    render(<ConfirmProvider><BrandFormDialog mode="edit" brand={bull} onClose={() => {}} onSaved={() => {}} /></ConfirmProvider>);
    expect(screen.getByRole('checkbox', { name: LABEL })).not.toBeNull();
    expect(screen.getByText(/also an ordinary word, e\.g\. Bull, ACE/)).not.toBeNull();
  });

  it('create: sends chipNeedsContext', async () => {
    const user = userEvent.setup();
    vi.mocked(createBrand).mockResolvedValue({ ...bull, chipNeedsContext: true });
    render(<ConfirmProvider><BrandFormDialog mode="create" onClose={() => {}} onSaved={() => {}} /></ConfirmProvider>);
    await user.type(screen.getByLabelText('Name'), 'Bull');
    await user.click(screen.getByRole('checkbox', { name: LABEL }));
    await user.click(screen.getByRole('button', { name: 'Add brand' }));
    expect(createBrand).toHaveBeenCalledWith(expect.objectContaining({ key: 'bull', name: 'Bull', chipNeedsContext: true }));
  });

  it('edit: sends only the changed flag', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    vi.mocked(updateBrand).mockResolvedValue({ ...bull, chipNeedsContext: true });
    render(<ConfirmProvider><BrandFormDialog mode="edit" brand={bull} onClose={() => {}} onSaved={onSaved} /></ConfirmProvider>);
    const box = screen.getByRole('checkbox', { name: LABEL }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateBrand).toHaveBeenCalledWith('b1', { chipNeedsContext: true });
    expect(onSaved).toHaveBeenCalled();
  });

  it('edit: starts ticked for a flagged brand', () => {
    render(
      <ConfirmProvider>
        <BrandFormDialog mode="edit" brand={{ ...bull, chipNeedsContext: true }} onClose={() => {}} onSaved={() => {}} />
      </ConfirmProvider>,
    );
    expect((screen.getByRole('checkbox', { name: LABEL }) as HTMLInputElement).checked).toBe(true);
  });
});
