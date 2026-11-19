// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

vi.mock('./verification-api', () => ({ fetchWaitingCount: vi.fn() }));
vi.mock('./listings-api', () => ({ fetchModerationWaiting: vi.fn() }));
vi.mock('./disputes-api', () => ({ fetchOpenDisputeCount: vi.fn() }));
const socketHandlers = new Map<string, () => void>();
vi.mock('./socket', () => ({
  getAdminSocket: () => ({
    on: (event: string, fn: () => void) => { socketHandlers.set(event, fn); },
    off: (event: string) => { socketHandlers.delete(event); },
  }),
}));
import { fetchOpenDisputeCount } from './disputes-api';
import { fetchWaitingCount } from './verification-api';
import { fetchModerationWaiting } from './listings-api';
import { NAV_BADGE_POLL_MS, badgeText, refreshNavBadges, useNavBadges } from './nav-badges';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('badgeText', () => {
  it('shows nothing for zero or an unknown count', () => {
    expect(badgeText('verificationWaiting', 0)).toBeNull();
    expect(badgeText('verificationWaiting', undefined)).toBeNull();
  });

  it('shows the count as it is, with no cap (the API counts)', () => {
    expect(badgeText('verificationWaiting', 4)).toBe('4');
    expect(badgeText('verificationWaiting', 250)).toBe('250');
  });
});

describe('useNavBadges', () => {
  it('fetches on mount, on refreshNavBadges, on focus and on the poll, not on re-render', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fetchWaitingCount).mockResolvedValue(3);
    const { result, rerender } = renderHook(() => useNavBadges(['verificationWaiting']));
    await waitFor(() => expect(result.current.verificationWaiting).toBe(3));
    expect(fetchWaitingCount).toHaveBeenCalledTimes(1);

    rerender();
    expect(fetchWaitingCount).toHaveBeenCalledTimes(1);

    act(() => refreshNavBadges());
    expect(fetchWaitingCount).toHaveBeenCalledTimes(2);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(fetchWaitingCount).toHaveBeenCalledTimes(3);
    act(() => { vi.advanceTimersByTime(NAV_BADGE_POLL_MS); });
    expect(fetchWaitingCount).toHaveBeenCalledTimes(4);
  });
});

describe('moderationWaiting (F2 spec §11.1)', () => {
  it('shows the Review + Reported count the API sums, nothing for zero', () => {
    expect(badgeText('moderationWaiting', 7)).toBe('7');
    expect(badgeText('moderationWaiting', 0)).toBeNull();
  });

  it('is fetched from the moderation counts only for the keys asked for', async () => {
    vi.mocked(fetchModerationWaiting).mockResolvedValue(5);
    vi.mocked(fetchWaitingCount).mockResolvedValue(2);
    const { result } = renderHook(() => useNavBadges(['moderationWaiting']));
    await waitFor(() => expect(result.current.moderationWaiting).toBe(5));
    expect(fetchWaitingCount).not.toHaveBeenCalled();
  });
});

describe('disputesOpen (F6 + F7 §16.1)', () => {
  it('is fetched from the dispute count and again on dispute:new', async () => {
    vi.mocked(fetchOpenDisputeCount).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    const { result, unmount } = renderHook(() => useNavBadges(['disputesOpen']));
    await waitFor(() => expect(result.current.disputesOpen).toBe(2));
    act(() => socketHandlers.get('dispute:new')!());
    await waitFor(() => expect(result.current.disputesOpen).toBe(3));
    expect(fetchWaitingCount).not.toHaveBeenCalled();
    unmount();
    expect(socketHandlers.has('dispute:new')).toBe(false);
  });

  it('subscribes to nothing for counts without a socket event', () => {
    vi.mocked(fetchWaitingCount).mockResolvedValue(0);
    renderHook(() => useNavBadges(['verificationWaiting']));
    expect(socketHandlers.size).toBe(0);
  });
});
