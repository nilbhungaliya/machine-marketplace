import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/conversations-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/conversations-api')>()),
  readThread: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { readThread } from '@/lib/conversations-api';
import { ReadReasonDialog } from './read-reason-dialog';

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

const THREAD = '22222222-2222-4222-8222-222222222222';
const READ = { threadId: THREAD, listing: { id: 'l', ref: 1, title: 'Gear' }, buyer: { businessId: 'b', name: 'B' }, seller: { businessId: 's', name: 'S' }, messages: [] };

function open() {
  const onRead = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfirmProvider>
      <ReadReasonDialog threadId={THREAD} basis={{ kind: 'dispute', label: 'Dispute on deal #100123' }} onClose={onClose} onRead={onRead} />
    </ConfirmProvider>,
  );
  return { onRead, onClose };
}

const button = () => screen.getByRole('button', { name: 'Read conversation' }) as HTMLButtonElement;

describe('ReadReasonDialog (F6 + F7 §16.3)', () => {
  it('shows the basis and that the read is audited', () => {
    open();
    expect(screen.getByText(/Dispute on deal #100123/)).not.toBeNull();
    expect(screen.getByText(/audit-logged/)).not.toBeNull();
  });

  it('will not call the API without a reason of 3 to 500 characters', async () => {
    const user = userEvent.setup();
    open();
    expect(button().disabled).toBe(true);
    await user.type(screen.getByLabelText('Why are you reading it?'), 'ab');
    expect(button().disabled).toBe(true);
    await user.click(button());
    await user.clear(screen.getByLabelText('Why are you reading it?'));
    await user.click(screen.getByLabelText('Why are you reading it?'));
    await user.paste('x'.repeat(501));
    expect(button().disabled).toBe(true);
    expect(readThread).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason and hands the messages over', async () => {
    const user = userEvent.setup();
    vi.mocked(readThread).mockResolvedValue(READ);
    const { onRead, onClose } = open();
    await user.type(screen.getByLabelText('Why are you reading it?'), '  Buyer says goods short  ');
    await user.click(button());
    await waitFor(() => expect(readThread).toHaveBeenCalledWith(THREAD, 'Buyer says goods short'));
    expect(onRead).toHaveBeenCalledWith(READ);
    expect(onClose).toHaveBeenCalled();
  });

  it('a refused read stays open and explains why', async () => {
    const user = userEvent.setup();
    vi.mocked(readThread).mockRejectedValue(new ApiError('nope', 403, 'ADMIN_READ_NOT_ALLOWED'));
    const { onRead, onClose } = open();
    await user.type(screen.getByLabelText('Why are you reading it?'), 'Checking the report');
    await user.click(button());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/open report or dispute/)));
    expect(onRead).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
