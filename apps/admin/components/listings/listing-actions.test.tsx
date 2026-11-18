import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminRole, ListingStatus } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';

const auth = vi.hoisted(() => ({ role: 'moderator' as AdminRole }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'a1', name: 'Admin', email: 'a@x.in', role: auth.role },
    isSuperAdmin: auth.role === 'super_admin',
    hasRole: (...roles: AdminRole[]) => auth.role === 'super_admin' || roles.includes(auth.role),
  }),
}));
vi.mock('@/lib/listings-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/listings-api')>()),
  approveListing: vi.fn(),
  askForChanges: vi.fn(),
  rejectListing: vi.fn(),
  hideListing: vi.fn(),
  unhideListing: vi.fn(),
  removeListing: vi.fn(),
}));
vi.mock('@/lib/nav-badges', () => ({ refreshNavBadges: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ApiError } from '@/lib/api';
import { approveListing, hideListing, rejectListing, unhideListing } from '@/lib/listings-api';
import { ListingActions } from './listing-actions';
import { detailFixture } from './test-fixtures';

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
  auth.role = 'moderator';
});

function renderActions(status: ListingStatus = 'pending_review', role: AdminRole = 'moderator') {
  auth.role = role;
  const detail = detailFixture({ status });
  const handlers = { onResult: vi.fn(), onConflict: vi.fn() };
  render(<ConfirmProvider><ListingActions detail={detail} {...handlers} /></ConfirmProvider>);
  return { detail, ...handlers };
}

const button = (name: string) => screen.queryByRole('button', { name });

describe('ListingActions', () => {
  it('Approve sends the version the page loaded and hands back the refreshed listing', async () => {
    const user = userEvent.setup();
    const next = detailFixture({ status: 'live', version: 5 });
    vi.mocked(approveListing).mockResolvedValue(next);
    const { onResult } = renderActions('pending_review');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(approveListing).toHaveBeenCalledWith('l1', 4);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(next));
  });

  it('Reject sends the version and the reason', async () => {
    const user = userEvent.setup();
    vi.mocked(rejectListing).mockResolvedValue(detailFixture({ status: 'rejected' }));
    renderActions('pending_review');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Stock photos');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(rejectListing).toHaveBeenCalledWith('l1', 4, 'Stock photos');
  });

  it('Hide sends the reason and no version', async () => {
    const user = userEvent.setup();
    vi.mocked(hideListing).mockResolvedValue(detailFixture({ status: 'hidden' }));
    renderActions('live');
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Fake photos');
    await user.click(within(dialog).getByRole('button', { name: 'Hide' }));
    expect(hideListing).toHaveBeenCalledWith('l1', 'Fake photos');
    expect(vi.mocked(hideListing).mock.calls[0]).toHaveLength(2);
  });

  it('a 409 LISTING_CHANGED is handed to the page (stale warning), not just toasted', async () => {
    const user = userEvent.setup();
    vi.mocked(approveListing).mockRejectedValue(new ApiError('Changed', 409, 'LISTING_CHANGED'));
    const { onConflict, onResult } = renderActions('pending_review');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onConflict).toHaveBeenCalledWith('LISTING_CHANGED'));
    expect(onResult).not.toHaveBeenCalled();
  });

  it('Unhide on a hidden listing without a photo says so', async () => {
    const user = userEvent.setup();
    vi.mocked(unhideListing).mockRejectedValue(new ApiError('Incomplete', 400, 'LISTING_INCOMPLETE'));
    renderActions('hidden');
    await user.click(screen.getByRole('button', { name: 'Unhide' }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Unhide' }));
    expect(await screen.findByText('This listing has no photo')).not.toBeNull();
  });

  it('shows only the buttons the status allows', () => {
    renderActions('pending_review');
    expect(button('Approve')).not.toBeNull();
    expect(button('Ask for changes')).not.toBeNull();
    expect(button('Reject')).not.toBeNull();
    expect(button('Hide')).toBeNull();
    expect(button('Unhide')).toBeNull();
    cleanup();

    renderActions('live');
    expect(button('Approve')).toBeNull();
    expect(button('Reject')).toBeNull();
    expect(button('Hide')).not.toBeNull();
    expect(button('Remove')).not.toBeNull();
    expect(button('Edit category, side or fit')).not.toBeNull();
    cleanup();

    renderActions('hidden');
    expect(button('Unhide')).not.toBeNull();
    expect(button('Hide')).toBeNull();
    cleanup();

    renderActions('removed');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('support sees no actions', () => {
    renderActions('pending_review', 'support');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
