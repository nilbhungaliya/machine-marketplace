import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/reviews-admin-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reviews-admin-api')>()),
  moderateReview: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { moderateReview } from '@/lib/reviews-admin-api';
import { ReviewHideDialog, type ModeratedReview } from './review-hide-dialog';

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

const REVIEW: ModeratedReview = { id: '33333333-3333-4333-8333-333333333333', hidden: false, replyText: 'Thanks', replyHidden: false };

function open(review = REVIEW) {
  const onDone = vi.fn();
  render(<ConfirmProvider><ReviewHideDialog review={review} onClose={vi.fn()} onDone={onDone} /></ConfirmProvider>);
  return { onDone };
}

type User = ReturnType<typeof userEvent.setup>;
const reason = (user: User, text = 'Shares a phone number') => user.type(screen.getByLabelText('Reason'), text);

describe('ReviewHideDialog (F6 + F7 §10.6)', () => {
  it('requires a reason before anything is sent', async () => {
    const user = userEvent.setup();
    open();
    const submit = screen.getByRole('button', { name: 'Hide review' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await reason(user, 'no');
    expect(submit.disabled).toBe(true);
    await user.click(submit);
    expect(moderateReview).not.toHaveBeenCalled();
  });

  it('hides the review with the reason', async () => {
    const user = userEvent.setup();
    vi.mocked(moderateReview).mockResolvedValue({});
    const { onDone } = open();
    await reason(user);
    await user.click(screen.getByRole('button', { name: 'Hide review' }));
    await waitFor(() => expect(moderateReview).toHaveBeenCalledWith(REVIEW.id, 'hide', 'Shares a phone number'));
    expect(onDone).toHaveBeenCalled();
  });

  it('hides only the reply when that is chosen', async () => {
    const user = userEvent.setup();
    vi.mocked(moderateReview).mockResolvedValue({});
    open();
    await user.click(screen.getByRole('radio', { name: /Hide only the reply/ }));
    await reason(user);
    await user.click(screen.getByRole('button', { name: 'Hide reply' }));
    await waitFor(() => expect(moderateReview).toHaveBeenCalledWith(REVIEW.id, 'hide_reply', 'Shares a phone number'));
  });

  it('offers no reply choice without a reply, and unhide for a hidden review', async () => {
    const user = userEvent.setup();
    vi.mocked(moderateReview).mockResolvedValue({});
    open({ ...REVIEW, replyText: null });
    expect((screen.getByRole('radio', { name: /Hide only the reply/ }) as HTMLInputElement).disabled).toBe(true);
    cleanup();
    open({ ...REVIEW, hidden: true });
    await reason(user, 'Appeal accepted');
    await user.click(screen.getByRole('button', { name: 'Unhide review' }));
    await waitFor(() => expect(moderateReview).toHaveBeenCalledWith(REVIEW.id, 'unhide', 'Appeal accepted'));
  });
});
