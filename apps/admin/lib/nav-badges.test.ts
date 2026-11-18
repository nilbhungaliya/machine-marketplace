// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

vi.mock('./verification-api', () => ({ fetchWaitingCount: vi.fn() }));
import { fetchWaitingCount } from './verification-api';
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
