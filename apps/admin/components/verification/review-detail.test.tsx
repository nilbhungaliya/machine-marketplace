import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/verification-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/verification-api')>()),
  fetchReview: vi.fn(),
  approveReview: vi.fn(),
  rejectReview: vi.fn(),
  askForMore: vi.fn(),
  fetchDocumentUrl: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { fetchDocumentUrl, fetchReview, rejectReview } from '@/lib/verification-api';
import { ReviewDetail } from './review-detail';
import { gstDetails, reviewFixture } from './test-fixtures';

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

function renderDetail() {
  const onChanged = vi.fn();
  render(<ConfirmProvider><ReviewDetail id="r1" onChanged={onChanged} /></ConfirmProvider>);
  return { onChanged };
}

/** The comparison row whose first cell is `field`. */
const compareRow = (field: string) =>
  within(screen.getByRole('table', { name: 'Business and GST details' })).getByRole('rowheader', { name: field }).closest('tr') as HTMLElement;

describe('ReviewDetail', () => {
  it('highlights the name row when the legal name differs from the business name', async () => {
    vi.mocked(fetchReview).mockResolvedValue(reviewFixture({
      business: { ...reviewFixture().business, tradeName: 'Ambica Spares' },
      mismatches: { legalName: true, pincode: false },
    }));
    renderDetail();
    await screen.findByRole('table', { name: 'Business and GST details' });

    const name = compareRow('Name');
    expect(name.getAttribute('data-mismatch')).toBe('true');
    expect(within(name).getByText("Doesn't match")).not.toBeNull();
    expect(within(name).getByText('Ambica Spares')).not.toBeNull();
    expect(within(name).getByText(gstDetails.legalName)).not.toBeNull();

    const pincode = compareRow('Pincode');
    expect(pincode.getAttribute('data-mismatch')).toBeNull();
    expect(within(pincode).queryByText("Doesn't match")).toBeNull();
  });

  it('labels the GST side "From the GST lookup" with a lookup, and links the GST portal search', async () => {
    vi.mocked(fetchReview).mockResolvedValue(reviewFixture());
    renderDetail();
    const table = await screen.findByRole('table', { name: 'Business and GST details' });
    expect(within(table).getByText('From the business')).not.toBeNull();
    expect(within(table).getByText('From the GST lookup')).not.toBeNull();
    const portal = screen.getByRole('link', { name: /Search on the GST portal/ });
    expect(portal.getAttribute('href')).toBe('https://services.gst.gov.in/services/searchtp');
    expect(portal.getAttribute('target')).toBe('_blank');
  });

  it('keeps the Reject button disabled until the reason has 3 characters', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchReview).mockResolvedValue(reviewFixture());
    vi.mocked(rejectReview).mockResolvedValue({ id: 'r1', businessId: 'b1', status: 'rejected' });
    const { onChanged } = renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));

    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Reject' }) as HTMLButtonElement;
    const reason = within(dialog).getByLabelText('Reason');
    expect(submit.disabled).toBe(true);
    await user.type(reason, 'ab');
    expect(submit.disabled).toBe(true);
    await user.type(reason, 'c');
    expect(submit.disabled).toBe(false);

    await user.click(submit);
    expect(rejectReview).toHaveBeenCalledWith('r1', 'abc');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('on 409 STALE_REVIEW says someone already decided and reloads the review', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchReview).mockResolvedValue(reviewFixture());
    vi.mocked(rejectReview).mockRejectedValue(new ApiError('Someone already decided this review', 409, 'STALE_REVIEW'));
    const { onChanged } = renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Wrong certificate');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Someone already decided this review'));
    await waitFor(() => expect(fetchReview).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('submits Reject with the red danger button, and Ask for more with the primary one', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchReview).mockResolvedValue(reviewFixture());
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Reject' }).className).toContain('text-red-600');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Ask for more' }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Send' }).className).toContain('bg-brand-600');
  });

  it('a review waiting for more files can only be rejected (no Approve or Ask for more)', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchReview).mockResolvedValue(reviewFixture({ status: 'needs_more', officerMessage: 'Add the second page' }));
    vi.mocked(rejectReview).mockResolvedValue({ id: 'r1', businessId: 'b1', status: 'rejected' });
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask for more' })).toBeNull();
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'No reply in two weeks');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(rejectReview).toHaveBeenCalledWith('r1', 'No reply in two weeks');
  });

  it('has no decision buttons once the review is decided', async () => {
    vi.mocked(fetchReview).mockResolvedValue(reviewFixture({ status: 'rejected', reason: 'Blurry certificate', decidedAt: '2026-11-18T06:00:00.000Z' }));
    renderDetail();
    await screen.findByText('Blurry certificate');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask for more' })).toBeNull();
  });

  it("says document storage isn't set up yet when a document link answers 503 STORAGE_UNAVAILABLE", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchReview).mockResolvedValue(reviewFixture({
      storageAvailable: true,
      documents: [{ index: 0, type: 'gst_certificate', format: 'png' }],
    }));
    vi.mocked(fetchDocumentUrl).mockRejectedValue(new ApiError("Document upload isn't available yet", 503, 'STORAGE_UNAVAILABLE'));
    renderDetail();
    await user.click(await screen.findByRole('button', { name: /GST certificate/ }));
    expect(await screen.findByText("Document storage isn't set up yet")).not.toBeNull();
  });
});
