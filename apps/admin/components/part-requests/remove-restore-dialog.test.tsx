import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminRole } from '@mpm/shared-types';

const auth = vi.hoisted(() => ({ role: 'support' as AdminRole }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'a1', name: 'Admin', email: 'a@x.in', role: auth.role },
    isSuperAdmin: auth.role === 'super_admin',
    hasRole: (...roles: AdminRole[]) => auth.role === 'super_admin' || roles.includes(auth.role),
  }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(), download: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ConfirmProvider } from '@/components/confirm-provider';
import { api } from '@/lib/api';
import { RemoveRestoreButton, type RemoveRestoreTarget } from './remove-restore-dialog';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) { return this.parentElement; },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  auth.role = 'support';
  document.body.style.overflow = '';
});

const ID = '33333333-3333-4333-8333-333333333333';
const ACTIVE: RemoveRestoreTarget = {
  id: ID, name: 'Gripper shaft', status: 'active', returnStatus: null, buyer: { businessId: 'b1', name: 'Shree Ambica' },
  reports: [],
};
const REMOVED: RemoveRestoreTarget = { ...ACTIVE, status: 'removed', returnStatus: 'active' };

function renderButton(request: RemoveRestoreTarget) {
  const onDone = vi.fn();
  render(<ConfirmProvider><RemoveRestoreButton request={request} onDone={onDone} /></ConfirmProvider>);
  return { onDone };
}

type User = ReturnType<typeof userEvent.setup>;

describe('Remove / Restore a part request (F8 §9.1, §14)', () => {
  it('shows no action to a role the API refuses, and the action to moderator, support and super_admin', () => {
    auth.role = 'operations';
    renderButton(ACTIVE);
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    cleanup();
    for (const role of ['moderator', 'support', 'super_admin'] as AdminRole[]) {
      auth.role = role;
      renderButton(ACTIVE);
      expect(screen.getByRole('button', { name: /Remove/ })).not.toBeNull();
      cleanup();
    }
  });

  it('needs a reason of at least 3 characters before anything is sent', async () => {
    const user: User = userEvent.setup();
    renderButton(ACTIVE);
    await user.click(screen.getByRole('button', { name: /Remove/ }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText('Reason'), ' ab ');
    expect(submit.disabled).toBe(true);
    await user.click(submit);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('removes an active request with { reason } on a danger button', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ ...ACTIVE, status: 'removed' });
    const { onDone } = renderButton(ACTIVE);
    await user.click(screen.getByRole('button', { name: /Remove/ }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Remove' });
    expect(submit.className).toContain('text-red-600');
    await user.type(within(dialog).getByLabelText('Reason'), '  Shares a phone number  ');
    await user.click(submit);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/admin/part-requests/${ID}/remove`, { reason: 'Shares a phone number' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('offers Restore only on a removed request and sends { reason } to restore', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ ...REMOVED, status: 'active' });
    renderButton(REMOVED);
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Restore/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Appeal accepted');
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/admin/part-requests/${ID}/restore`, { reason: 'Appeal accepted' }));
  });
});
