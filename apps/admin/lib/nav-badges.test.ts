import { describe, expect, it, vi } from 'vitest';

vi.mock('./verification-api', () => ({ fetchWaitingCount: vi.fn(), REVIEW_LIST_CAP: 200 }));
import { badgeText } from './nav-badges';

describe('badgeText', () => {
  it('shows nothing for zero or an unknown count', () => {
    expect(badgeText('verificationWaiting', 0)).toBeNull();
    expect(badgeText('verificationWaiting', undefined)).toBeNull();
  });

  it('shows the count, and "200+" at the review list cap', () => {
    expect(badgeText('verificationWaiting', 4)).toBe('4');
    expect(badgeText('verificationWaiting', 200)).toBe('200+');
  });
});
