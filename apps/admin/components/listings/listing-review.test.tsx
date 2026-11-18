import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminRole } from '@mpm/shared-types';
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
  fetchAdminListing: vi.fn(),
  fetchListingTemplate: vi.fn().mockRejectedValue(new Error('offline')),
  approveListing: vi.fn(),
  askForChanges: vi.fn(),
  deleteListingMedia: vi.fn(),
  resolveReports: vi.fn(),
}));
vi.mock('@/lib/nav-badges', () => ({ refreshNavBadges: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import {
  approveListing, askForChanges, deleteListingMedia, fetchAdminListing, fetchListingTemplate, resolveReports,
} from '@/lib/listings-api';
import { ListingReview } from './listing-review';
import { FULL_PHOTO_URL, detailFixture, machineFixture } from './test-fixtures';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) { return this.parentElement; },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(fetchListingTemplate).mockRejectedValue(new Error('offline'));
  document.body.style.overflow = '';
  auth.role = 'moderator';
});

function renderReview() {
  const onChanged = vi.fn();
  render(<ConfirmProvider><ListingReview id="l1" onChanged={onChanged} /></ConfirmProvider>);
  return { onChanged };
}

describe('ListingReview', () => {
  it('shows the private fields: address line, pincode, map link and review-reason pills', async () => {
    vi.mocked(fetchAdminListing).mockResolvedValue(detailFixture());
    renderReview();
    await screen.findByRole('heading', { name: 'Temple roller, left' });
    expect(screen.getByText('Shed 14, Road B')).not.toBeNull();
    expect(screen.getByText('360003')).not.toBeNull();
    expect(screen.getByRole('link', { name: /Open in Google Maps/ }).getAttribute('href')).toContain('22.29,70.8');
    expect(screen.getByText('Unverified seller')).not.toBeNull();
    expect(screen.getAllByText('Price check').length).toBeGreaterThan(0);
    // "Other" texts typed by the seller are highlighted.
    expect(screen.getByText('GTX Plus').closest('[data-other]')).not.toBeNull();
    // Seller panel links to the business.
    expect(screen.getByRole('link', { name: 'Shree Ambica Engineering' }).getAttribute('href')).toMatch(/^\/businesses\/b1\/?\?from=/);
  });

  it("shows a machine's serial number", async () => {
    vi.mocked(fetchAdminListing).mockResolvedValue(machineFixture());
    renderReview();
    expect(await screen.findByText('SN-44821-B')).not.toBeNull();
    expect(screen.getByText('Jinlong').closest('[data-other]')).not.toBeNull();
  });

  it('opens the full image, not the thumbnail, in the lightbox, and the video with its poster', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAdminListing).mockResolvedValue(detailFixture());
    renderReview();
    await user.click(await screen.findByRole('button', { name: 'Open photo 1' }));
    const img = await screen.findByRole('img', { name: /Temple roller, left/ });
    expect(img.getAttribute('src')).toBe(FULL_PHOTO_URL);
    const video = document.querySelector('video');
    expect(video?.getAttribute('poster')).toContain('v1-poster.jpg');
    expect(video?.hasAttribute('controls')).toBe(true);
  });

  it('a 409 LISTING_CHANGED shows the stale warning; Reload loads the listing again', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAdminListing).mockResolvedValue(detailFixture());
    vi.mocked(approveListing).mockRejectedValue(new ApiError('Changed', 409, 'LISTING_CHANGED'));
    renderReview();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const warning = await screen.findByRole('alert');
    expect(warning.textContent).toMatch(/seller changed this listing/i);
    await user.click(within(warning).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(fetchAdminListing).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/seller changed this listing/i)).toBeNull());
  });

  it('deleting a photo sends the reason and says when the CDN copy may linger', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAdminListing).mockResolvedValue(detailFixture());
    vi.mocked(deleteListingMedia).mockResolvedValue({ purge: 'failed' });
    const { onChanged } = renderReview();
    await user.click(await screen.findByRole('button', { name: 'Delete photo 1' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/last photo/i)).not.toBeNull();
    await user.type(within(dialog).getByLabelText('Reason'), 'Shows a phone number');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(deleteListingMedia).toHaveBeenCalledWith('l1', 'm1', 'Shows a phone number');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deleted. The CDN copy may take a while to clear.'));
    await waitFor(() => expect(fetchAdminListing).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalled();
  });

  it('resolves open reports with the outcome and the note', async () => {
    const user = userEvent.setup();
    const reported = detailFixture({ status: 'live' }, {
      reports: [{
        id: 'r1', reason: 'wrong_side_or_fit', details: null, status: 'open',
        reporter: { businessId: 'b2', businessName: 'Vatva Automation' }, createdAt: '2026-11-18T06:00:00.000Z',
        resolvedAt: null, resolutionNote: null,
      }],
    });
    vi.mocked(fetchAdminListing).mockResolvedValue(reported);
    vi.mocked(resolveReports).mockResolvedValue(detailFixture({ status: 'live' }));
    renderReview();
    expect(await screen.findByText('Wrong side or fit')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Resolve reports' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Dismiss' }));
    await user.type(within(dialog).getByLabelText(/Note/), 'Side is right');
    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    expect(resolveReports).toHaveBeenCalledWith('l1', 'dismissed', 'Side is right');
  });

  it('support reads everything but sees no actions', async () => {
    auth.role = 'support';
    vi.mocked(fetchAdminListing).mockResolvedValue(detailFixture());
    renderReview();
    await screen.findByRole('heading', { name: 'Temple roller, left' });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete photo 1' })).toBeNull();
    expect(screen.getByText('Shed 14, Road B')).not.toBeNull();
  });

  it('a stale decision keeps the typed message; Reload, then Send goes with the fresh version', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAdminListing)
      .mockResolvedValueOnce(detailFixture())
      .mockResolvedValue(detailFixture({ version: 5 }));
    vi.mocked(askForChanges)
      .mockRejectedValueOnce(new ApiError('Changed', 409, 'LISTING_CHANGED'))
      .mockResolvedValue(detailFixture({ status: 'rejected', version: 6 }));
    renderReview();
    await user.click(await screen.findByRole('button', { name: 'Ask for changes' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Message to the seller'), 'Add a photo of the part number');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(askForChanges).toHaveBeenCalledWith('l1', 4, 'Add a photo of the part number');

    // The dialog stays, with what was typed and the stale message; Send waits for Reload.
    expect(await within(dialog).findByText(/seller changed this listing/i)).not.toBeNull();
    expect((within(dialog).getByLabelText('Message to the seller') as HTMLTextAreaElement).value).toBe('Add a photo of the part number');
    expect((within(dialog).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(dialog).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(fetchAdminListing).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(dialog).queryByText(/seller changed this listing/i)).toBeNull());
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(askForChanges).toHaveBeenLastCalledWith('l1', 5, 'Add a photo of the part number');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('while the listing is stale the action buttons wait for Reload', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAdminListing).mockResolvedValue(detailFixture());
    vi.mocked(approveListing).mockRejectedValue(new ApiError('Changed', 409, 'LISTING_CHANGED'));
    renderReview();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Edit category, side or fit' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('a photo someone already deleted (404 MEDIA_NOT_FOUND) closes the dialog and reloads', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAdminListing).mockResolvedValue(detailFixture());
    vi.mocked(deleteListingMedia).mockRejectedValue(new ApiError('Gone', 404, 'MEDIA_NOT_FOUND'));
    renderReview();
    await user.click(await screen.findByRole('button', { name: 'Delete photo 1' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Shows a phone number');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(fetchAdminListing).toHaveBeenCalledTimes(2));
  });
});
