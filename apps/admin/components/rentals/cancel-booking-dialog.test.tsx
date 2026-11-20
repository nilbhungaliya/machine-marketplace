import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'a1', name: 'Admin', email: 'a@x.in', role: 'support' }, isSuperAdmin: false, hasRole: () => true }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(), download: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ConfirmProvider } from '@/components/confirm-provider';
import { api } from '@/lib/api';
import { CancelBookingButton, type CancelBookingTarget } from './cancel-booking-dialog';

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

const ID = '44444444-4444-4444-8444-444444444444';
const BOOKING: CancelBookingTarget = {
  id: ID, ref: 700001, status: 'confirmed', renter: { businessId: 'r', name: 'Renter Works' }, owner: { businessId: 'o', name: 'Owner Cranes' },
};

function renderButton() {
  const onDone = vi.fn();
  render(<ConfirmProvider><CancelBookingButton booking={BOOKING} onDone={onDone} /></ConfirmProvider>);
  return { onDone };
}

describe('Cancel booking (M14 §15)', () => {
  it('refuses a reason under 3 characters, then posts { reason } on a danger button', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ ...BOOKING, status: 'cancelled' });
    const { onDone } = renderButton();
    await user.click(screen.getByRole('button', { name: /Cancel booking/ }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Cancel booking' }) as HTMLButtonElement;
    expect(submit.className).toContain('text-red-600');
    await user.type(within(dialog).getByLabelText('Reason'), ' ab ');
    expect(submit.disabled).toBe(true);
    await user.click(submit);
    expect(api.post).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Reason'), 'c owner asked');
    await user.click(submit);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/admin/rental-bookings/${ID}/cancel`, { reason: 'ab c owner asked' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
