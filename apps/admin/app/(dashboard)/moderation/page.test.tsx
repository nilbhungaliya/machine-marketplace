import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { AdminModerationQueue, AdminRole, ModerationTab } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';
import { detailFixture, moderationRow } from '@/components/listings/test-fixtures';

vi.mock('next/navigation', () => ({ usePathname: () => '/moderation' }));
const auth = vi.hoisted(() => ({ role: 'moderator' as AdminRole }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'a1', name: 'Admin', email: 'a@x.in', role: auth.role },
    isSuperAdmin: false,
    hasRole: (...roles: AdminRole[]) => roles.includes(auth.role),
  }),
}));
vi.mock('@/lib/listings-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/listings-api')>()),
  fetchModerationQueue: vi.fn(),
  fetchModerationCounts: vi.fn().mockResolvedValue({ review: 0, reported: 0 }),
  fetchAdminListing: vi.fn(),
  fetchListingTemplate: vi.fn().mockRejectedValue(new Error('offline')),
}));
vi.mock('@/lib/nav-badges', () => ({ refreshNavBadges: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { fetchAdminListing, fetchModerationQueue } from '@/lib/listings-api';
import ModerationPage from './page';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) { return this.parentElement; },
  });
});

beforeEach(() => window.history.replaceState(null, '', '/moderation'));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const queue = (tab: ModerationTab, page: number, rows: AdminModerationQueue['rows'], total: number): AdminModerationQueue =>
  ({ tab, rows, total, page, pageSize: 50 });

describe('ModerationPage', () => {
  it('steps back a page when the page it was on has emptied (its last listing was decided)', async () => {
    window.history.replaceState(null, '', '/moderation?page=2');
    vi.mocked(fetchModerationQueue).mockImplementation(async (tab: ModerationTab, page = 1) =>
      (page === 2 ? queue(tab, 2, [], 50) : queue(tab, 1, [moderationRow()], 50)));
    vi.mocked(fetchAdminListing).mockResolvedValue(detailFixture());
    render(<ConfirmProvider><ModerationPage /></ConfirmProvider>);

    await waitFor(() => expect(fetchModerationQueue).toHaveBeenCalledWith('review', 2));
    await waitFor(() => expect(fetchModerationQueue).toHaveBeenLastCalledWith('review', 1));
    expect(new URLSearchParams(window.location.search).get('page')).toBeNull();
  });
});
