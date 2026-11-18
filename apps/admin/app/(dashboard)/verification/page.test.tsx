import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminGstReviewRow, GstReviewQueue } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';
import { reviewFixture } from '@/components/verification/test-fixtures';

vi.mock('next/navigation', () => ({ usePathname: () => '/verification' }));
vi.mock('@/lib/verification-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/verification-api')>()),
  fetchReviews: vi.fn(),
  fetchReview: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { fetchReview, fetchReviews } from '@/lib/verification-api';
import VerificationPage from './page';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) { return this.parentElement; },
  });
});

beforeEach(() => window.history.replaceState(null, '', '/verification'));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const waitingRow: AdminGstReviewRow = {
  id: 'r1', businessId: 'b1', businessName: 'Shree Ambica Engineering', city: 'Rajkot', gstin: '24AAKFS4821M1Z6',
  status: 'waiting', hasLookup: true, documentCount: 2, createdAt: '2026-11-18T05:00:00.000Z',
  updatedAt: '2026-11-18T05:00:00.000Z', decidedAt: null,
};

const reviewParam = () => new URLSearchParams(window.location.search).get('review');

describe('VerificationPage', () => {
  it('opens the first waiting review, and switching to an empty tab leaves no review selected', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchReviews).mockImplementation(async (status: GstReviewQueue) => (status === 'waiting' ? [waitingRow] : []));
    vi.mocked(fetchReview).mockResolvedValue(reviewFixture());
    render(<ConfirmProvider><VerificationPage /></ConfirmProvider>);

    await waitFor(() => expect(reviewParam()).toBe('r1'));
    expect(await screen.findByRole('button', { name: 'Approve' })).not.toBeNull();

    await user.click(screen.getByRole('tab', { name: /Needs more/ }));
    expect(await screen.findByText('Nobody owes you files')).not.toBeNull();
    expect(reviewParam()).toBeNull();
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('needs_more');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(fetchReviews).toHaveBeenLastCalledWith('needs_more');
  });
});
