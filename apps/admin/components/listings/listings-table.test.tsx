import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminRole } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';

const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/listings', useRouter: () => ({ push }) }));
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
  fetchAdminListings: vi.fn(),
  bulkListings: vi.fn(),
}));
vi.mock('@/lib/catalog-api', () => ({ fetchAdminTree: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/nav-badges', () => ({ refreshNavBadges: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { bulkListings, fetchAdminListings } from '@/lib/listings-api';
import { ListingsTable } from './listings-table';
import { listFixture, listingRow } from './test-fixtures';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) { return this.parentElement; },
  });
});

beforeEach(() => window.history.replaceState(null, '', '/listings'));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.style.overflow = '';
  auth.role = 'moderator';
});

const SELLER = '7d1f3c2a-5b6e-4f80-9a1b-2c3d4e5f6a7b';
const param = (name: string) => new URLSearchParams(window.location.search).get(name);

function renderTable(role: AdminRole = 'moderator') {
  auth.role = role;
  render(<ConfirmProvider><ListingsTable /></ConfirmProvider>);
}

describe('ListingsTable', () => {
  it('filters write the URL as comma lists, and the next fetch uses them', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAdminListings).mockResolvedValue(listFixture([listingRow('l1')]));
    renderTable();
    await screen.findByText('Listing l1');

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Live' }));
    await user.click(within(dialog).getByRole('button', { name: 'Paused' }));
    await user.click(within(dialog).getByRole('button', { name: 'Has open reports' }));
    await user.click(within(dialog).getByRole('button', { name: /^(Apply|Show)/ }));

    await waitFor(() => expect(param('status')).toBe('live,paused'));
    expect(param('reported')).toBe('1');
    await waitFor(() => expect(fetchAdminListings).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: ['live', 'paused'], reported: true }),
    ));
  });

  it('shows the seller filter as a removable chip with the business name', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/listings?businessId=${SELLER}`);
    vi.mocked(fetchAdminListings).mockResolvedValue(listFixture([listingRow('l1')], { business: { id: SELLER, name: 'Shree Ambica Engineering' } }));
    renderTable();
    await waitFor(() => expect(fetchAdminListings).toHaveBeenCalledWith(expect.objectContaining({ businessId: SELLER })));
    const remove = await screen.findByRole('button', { name: 'Remove Seller' });
    expect(remove.parentElement?.textContent).toContain('Shree Ambica Engineering');
    await user.click(remove);
    expect(param('businessId')).toBeNull();
  });

  it('ignores a seller or category in the URL that is not a uuid, and caps the search', async () => {
    window.history.replaceState(null, '', '/listings?businessId=b1&machineCategoryId=nope');
    vi.mocked(fetchAdminListings).mockResolvedValue(listFixture([listingRow('l1')]));
    renderTable();
    await screen.findByText('Listing l1');
    const filters = vi.mocked(fetchAdminListings).mock.calls.at(-1)![0]!;
    expect(filters.businessId).toBeUndefined();
    expect(filters.machineCategoryId).toBeUndefined();
    expect(screen.getByRole('searchbox').getAttribute('maxlength')).toBe('100');
  });

  it('support sees no checkboxes and no bulk actions', async () => {
    vi.mocked(fetchAdminListings).mockResolvedValue(listFixture([listingRow('l1'), listingRow('l2')]));
    renderTable('support');
    await screen.findByText('Listing l1');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Hide selected/ })).toBeNull();
  });

  it('bulk Hide sends the selected ids and the reason, and reports the skipped rows', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAdminListings).mockResolvedValue(listFixture([listingRow('l1'), listingRow('l2', 'removed')]));
    vi.mocked(bulkListings).mockResolvedValue({ done: ['l1'], skipped: [{ id: 'l2', code: 'LISTING_TRANSITION_NOT_ALLOWED' }] });
    renderTable();
    await screen.findByText('Listing l1');

    await user.click(screen.getByRole('checkbox', { name: 'Select Listing l1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Listing l2' }));
    expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Hide selected (2)' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Fake stock from one seller');
    await user.click(within(dialog).getByRole('button', { name: 'Hide 2' }));

    expect(bulkListings).toHaveBeenCalledWith({ action: 'hide', ids: ['l1', 'l2'], reason: 'Fake stock from one seller' });
    const result = await screen.findByRole('dialog', { name: /Hid 1 listing/ });
    expect(within(result).getByText('Listing l2')).not.toBeNull();
    expect(within(result).getByText("Can't be hidden or removed in its status")).not.toBeNull();
  });

  it('a row opens the listing page', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAdminListings).mockResolvedValue(listFixture([listingRow('l1')]));
    renderTable();
    await user.click(await screen.findByText('Listing l1'));
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/listings\/l1\//));
  });
});
