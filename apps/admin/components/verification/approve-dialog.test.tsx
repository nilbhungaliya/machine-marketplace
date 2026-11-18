import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminGstReviewDetail } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';
import { ApproveDialog } from './approve-dialog';
import { gstDetails as details, reviewFixture } from './test-fixtures';

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

function renderDialog(review: AdminGstReviewDetail) {
  const onApprove = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(<ConfirmProvider><ApproveDialog review={review} onApprove={onApprove} onClose={onClose} /></ConfirmProvider>);
  return { onApprove, onClose };
}

describe('ApproveDialog', () => {
  it('hides the edit fields when a lookup is attached and a provider is available', () => {
    renderDialog(reviewFixture());
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText('Legal name')).toBeNull();
    expect(within(dialog).queryByLabelText('Trade name')).toBeNull();
    expect(within(dialog).queryByLabelText('Constitution')).toBeNull();
    expect(within(dialog).queryByLabelText('Address')).toBeNull();
  });

  it('shows the edit fields, prefilled, when no lookup is attached', () => {
    renderDialog(reviewFixture({
      lookup: null,
      entered: { legalName: 'Ambica Engg', tradeName: null, address: details.address, constitution: 'proprietorship' },
    }));
    expect((screen.getByLabelText('Legal name') as HTMLInputElement).value).toBe('Ambica Engg');
    expect(screen.getByLabelText('Trade name')).not.toBeNull();
    expect((screen.getByLabelText('Constitution') as HTMLSelectElement).value).toBe('proprietorship');
    expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('Plot 214, Aji GIDC');
    expect((screen.getByLabelText('Pincode') as HTMLInputElement).value).toBe('360003');
  });

  it('shows the edit fields when the provider is unavailable, even with a lookup attached', () => {
    renderDialog(reviewFixture({ providerAvailable: false }));
    expect((screen.getByLabelText('Legal name') as HTMLInputElement).value).toBe('SHREE AMBICA ENGINEERING');
  });

  it('sends only the fields the officer changed', async () => {
    const user = userEvent.setup();
    const { onApprove } = renderDialog(reviewFixture({ providerAvailable: false }));
    const legal = screen.getByLabelText('Legal name');
    await user.clear(legal);
    await user.type(legal, 'Shree Ambica Engineering LLP');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith({ legalName: 'Shree Ambica Engineering LLP' });
  });

  it('approves with no edits when a fresh lookup decides', async () => {
    const user = userEvent.setup();
    const { onApprove } = renderDialog(reviewFixture());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith({});
  });
});
