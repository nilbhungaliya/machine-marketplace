import { describe, expect, it } from 'vitest';
import {
  appSettingDefaults,
  counterBounds,
  dealYourTurn,
  enquiryStatus,
  fitsUnitDecimals,
  percentBelowAsking,
  publishDueAt,
  quantityToMilli,
  threadTurns,
  totalPaise,
  validateSettings,
} from '@mpm/shared-types';

// F6 + F7 plan C0-1: the pure functions both the API and the app use (spec §5.16, §6.2, §6.10, §7.2, §7.4, §9.2, §10.3, §17).

describe('totalPaise (§7.2: half up from thousandths)', () => {
  it.each([
    [5, '0.1', 1n],
    [3, '0.1', 0n],
    [333, '1.5', 500n],
    [3400000, '2.500', 8500000n],
  ])('%i × %s = %s', (price, qty, want) => {
    expect(totalPaise(price, qty)).toBe(want);
  });

  it('is exact at the largest price and quantity', () => {
    // 2147483647 × 99999999999999 thousandths, + 500, / 1000, in exact integer arithmetic.
    const want = (2147483647n * 99999999999999n + 500n) / 1000n;
    expect(totalPaise(2147483647, '99999999999.999')).toBe(want);
  });
});

describe('quantities', () => {
  it('quantityToMilli refuses four decimals', () => {
    expect(quantityToMilli('2.5')).toBe(2500n);
    expect(() => quantityToMilli('1.2345')).toThrow();
  });

  it('fitsUnitDecimals ignores trailing zeros', () => {
    expect(fitsUnitDecimals('2', 0)).toBe(true);
    expect(fitsUnitDecimals('2.50', 1)).toBe(true);
    expect(fitsUnitDecimals('2.5', 0)).toBe(false);
    expect(fitsUnitDecimals('2.125', 2)).toBe(false);
  });
});

describe('percentBelowAsking (P13: rounds down, null at or above)', () => {
  it('rounds down', () => {
    expect(percentBelowAsking(90, 100)).toBe(10);
    expect(percentBelowAsking(66667, 100000)).toBe(33);
  });
  it('null at or above asking', () => {
    expect(percentBelowAsking(100, 100)).toBeNull();
    expect(percentBelowAsking(120, 100)).toBeNull();
  });
});

describe('counterBounds (§7.4)', () => {
  it('buyer after a quote (no B): 1 … S − 1', () => {
    expect(counterBounds({ by: 'buyer', buyerLatestPaise: null, sellerLatestPaise: 50000 })).toEqual({ minPaise: 1, maxPaise: 49999 });
  });
  it('buyer with B: B … S − 1', () => {
    expect(counterBounds({ by: 'buyer', buyerLatestPaise: 30000, sellerLatestPaise: 38500 })).toEqual({ minPaise: 30000, maxPaise: 38499 });
  });
  it('seller with B: B + 1 … S', () => {
    expect(counterBounds({ by: 'seller', buyerLatestPaise: 30000, sellerLatestPaise: 38500 })).toEqual({ minPaise: 30001, maxPaise: 38500 });
  });
  it('after three counters the range has narrowed to the latest two prices', () => {
    // offer 30 000 (asking 40 000) → seller 38 000 → buyer 34 000 → seller 36 000; the buyer counters next.
    expect(counterBounds({ by: 'buyer', buyerLatestPaise: 34000, sellerLatestPaise: 36000 })).toEqual({ minPaise: 34000, maxPaise: 35999 });
    expect(counterBounds({ by: 'seller', buyerLatestPaise: 34000, sellerLatestPaise: 36000 })).toEqual({ minPaise: 34001, maxPaise: 36000 });
  });
});

describe('enquiryStatus (§6.2, first match wins)', () => {
  const base = { dealCount: 0, firstSellerReplyAt: null, hasOpenNegotiation: false, listingPublic: true, blocked: false };
  it('open', () => expect(enquiryStatus(base)).toBe('open'));
  it('replied', () => expect(enquiryStatus({ ...base, firstSellerReplyAt: '2026-11-19T10:00:00Z' })).toBe('replied'));
  it('closed by a block, even after a reply', () => {
    expect(enquiryStatus({ ...base, firstSellerReplyAt: '2026-11-19T10:00:00Z', blocked: true })).toBe('closed');
  });
  it('closed when the listing is gone and nothing is open', () => {
    expect(enquiryStatus({ ...base, listingPublic: false })).toBe('closed');
  });
  it('not closed while a negotiation is open on a non-public listing', () => {
    expect(enquiryStatus({ ...base, listingPublic: false, hasOpenNegotiation: true })).toBe('open');
  });
  it('converted beats closed', () => {
    expect(enquiryStatus({ ...base, dealCount: 1, blocked: true, listingPublic: false })).toBe('converted');
  });
});

describe('threadTurns and dealYourTurn (§6.10, §9.2)', () => {
  const none = { openTurn: null, enquiryOpen: false, deals: [] };
  it('pending offer: the turn side', () => {
    expect(threadTurns({ ...none, openTurn: 'seller' })).toEqual({ buyer: false, seller: true });
  });
  it('open enquiry: the seller', () => {
    expect(threadTurns({ ...none, enquiryOpen: true })).toEqual({ buyer: false, seller: true });
  });
  it('agreed deal: the seller hands over', () => {
    expect(threadTurns({ ...none, deals: [{ status: 'agreed', cancelRequestedSide: null }] })).toEqual({ buyer: false, seller: true });
  });
  it('handed over: the buyer confirms', () => {
    expect(threadTurns({ ...none, deals: [{ status: 'handed_over', cancelRequestedSide: null }] })).toEqual({ buyer: true, seller: false });
  });
  it("buyer's cancel request: the seller's turn", () => {
    expect(threadTurns({ ...none, deals: [{ status: 'handed_over', cancelRequestedSide: 'buyer' }] })).toEqual({ buyer: false, seller: true });
  });
  it('dealYourTurn: nothing on final or disputed deals', () => {
    for (const status of ['completed', 'cancelled', 'disputed'] as const) {
      expect(dealYourTurn({ status, cancelRequestedSide: null }, 'buyer')).toBe(false);
      expect(dealYourTurn({ status, cancelRequestedSide: null }, 'seller')).toBe(false);
    }
    expect(dealYourTurn({ status: 'handed_over', cancelRequestedSide: 'seller' }, 'buyer')).toBe(true);
  });
});

describe('publishDueAt (§10.3: the earlier bound)', () => {
  const day = 86_400_000;
  const completed = new Date('2026-11-01T10:00:00Z');
  it('blind wait when it ends first', () => {
    const submitted = new Date(completed.getTime() + 2 * day);
    expect(publishDueAt(submitted, completed, 7, 14).getTime()).toBe(submitted.getTime() + 7 * day);
  });
  it('the review window when it ends first', () => {
    const submitted = new Date(completed.getTime() + 10 * day);
    expect(publishDueAt(submitted, completed, 7, 14).getTime()).toBe(completed.getTime() + 14 * day);
  });
});

describe('validateSettings: the five §17 cross-checks', () => {
  const d = appSettingDefaults();
  it('accepts the defaults', () => expect(validateSettings(d)).toBeNull());
  it.each([
    [{ offer_validity_hours_1: 48 }, 'offer_validity_hours_1'],
    [{ offer_validity_hours_2: 168 }, 'offer_validity_hours_2'],
    [{ offer_expiring_notice_hours: 24 }, 'offer_expiring_notice_hours'],
    [{ deal_problem_window_days: 3 }, 'deal_problem_window_days'],
    [{ review_blind_days: 15 }, 'review_blind_days'],
    [{ offer_backup_max_days: 6 }, 'offer_backup_max_days'],
  ])('refuses %o', (patch, key) => {
    expect(validateSettings({ ...d, ...patch })?.key).toBe(key);
  });
});
