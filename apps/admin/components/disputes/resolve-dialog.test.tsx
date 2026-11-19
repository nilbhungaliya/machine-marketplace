import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/disputes-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/disputes-api')>()),
  resolveDispute: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { resolveDispute } from '@/lib/disputes-api';
import { ResolveDialog } from './resolve-dialog';

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

const DISPUTE = {
  id: '11111111-1111-4111-8111-111111111111',
  dealRef: 100123,
  buyer: { businessId: 'b', name: 'Buyer Works' },
  seller: { businessId: 's', name: 'Seller Spares' },
};

function open() {
  const onResolved = vi.fn().mockResolvedValue(undefined);
  render(<ConfirmProvider><ResolveDialog dispute={DISPUTE} onClose={vi.fn()} onResolved={onResolved} /></ConfirmProvider>);
  return { onResolved };
}

type User = ReturnType<typeof userEvent.setup>;
const submit = (user: User) => user.click(screen.getByRole('button', { name: 'Resolve' }));
const note = (user: User, text = 'Seller showed the courier slip') => user.type(screen.getByLabelText('Internal note'), text);

describe('ResolveDialog (F6 + F7 §9.6)', () => {
  it('asks "Did the goods go back to the seller?" only for cancelled, with nothing preselected', async () => {
    const user = userEvent.setup();
    open();
    expect(screen.queryByText('Did the goods go back to the seller?')).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Close as cancelled/ }));
    expect(screen.getByText('Did the goods go back to the seller?')).not.toBeNull();
    expect((screen.getByRole('radio', { name: /^Yes/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('radio', { name: /^No/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('will not resolve as cancelled without the goods answer', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('radio', { name: /Close as cancelled/ }));
    await note(user);
    await submit(user);
    expect(await screen.findByText('Say whether the goods went back to the seller')).not.toBeNull();
    expect(resolveDispute).not.toHaveBeenCalled();
  });

  it.each([
    ['Yes', true],
    ['No', false],
  ])('cancelled with "%s" sends stockReturned %s', async (answer, expected) => {
    const user = userEvent.setup();
    vi.mocked(resolveDispute).mockResolvedValue({} as never);
    const { onResolved } = open();
    await user.click(screen.getByRole('radio', { name: /Close as cancelled/ }));
    await user.click(screen.getByRole('radio', { name: new RegExp(`^${answer}`) }));
    await note(user);
    await submit(user);
    await waitFor(() => expect(resolveDispute).toHaveBeenCalledWith(DISPUTE.id, {
      outcome: 'cancelled',
      stockReturned: expected,
      internalNote: 'Seller showed the courier slip',
      messageToParties: null,
    }));
    expect(onResolved).toHaveBeenCalled();
  });

  it('completed and resumed send no stockReturned, and the message to the parties when written', async () => {
    const user = userEvent.setup();
    vi.mocked(resolveDispute).mockResolvedValue({} as never);
    open();
    await user.click(screen.getByRole('radio', { name: /Close as completed/ }));
    await note(user);
    await user.type(screen.getByLabelText(/Message to both parties/), '  Goods matched the photos.  ');
    await submit(user);
    await waitFor(() => expect(resolveDispute).toHaveBeenCalledWith(DISPUTE.id, {
      outcome: 'completed',
      internalNote: 'Seller showed the courier slip',
      messageToParties: 'Goods matched the photos.',
    }));
  });

  it('requires an outcome and an internal note of 3 to 500 characters', async () => {
    const user = userEvent.setup();
    open();
    await submit(user);
    expect(await screen.findByText('Choose an outcome')).not.toBeNull();
    expect(screen.getByText('Write an internal note of 3 to 500 characters')).not.toBeNull();
    await user.click(screen.getByRole('radio', { name: /Resume the deal/ }));
    await note(user, 'ok');
    await submit(user);
    expect(await screen.findByText('Write an internal note of 3 to 500 characters')).not.toBeNull();
    expect(resolveDispute).not.toHaveBeenCalled();
  });

  it('refuses a message to the parties over 500 characters', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('radio', { name: /Resume the deal/ }));
    await note(user);
    const long = screen.getByLabelText(/Message to both parties/) as HTMLTextAreaElement;
    // Typing 501 characters one by one is slow; paste them.
    await user.click(long);
    await user.paste('x'.repeat(501));
    await submit(user);
    expect(await screen.findByText('At most 500 characters')).not.toBeNull();
    expect(resolveDispute).not.toHaveBeenCalled();
  });
});
