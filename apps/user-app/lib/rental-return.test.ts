import { describe, expect, it } from 'vitest';
import { percentVsEstimate, returnFormErrors } from './rental-return';

describe('percentVsEstimate (§6.3)', () => {
  it('is the whole signed percent of the owner total against the estimate', () => {
    expect(percentVsEstimate(9000, 10000)).toBe(-10);
    expect(percentVsEstimate(11_250, 10_000)).toBe(13);
    expect(percentVsEstimate(10_000, 10_000)).toBe(0);
  });
});

describe('returnFormErrors (§6.4)', () => {
  const base = { finalPaise: 10_000, agreedPaise: 10_000, reason: null, hourStart: 120, hourEnd: 150 };
  it('requires a reason only when the final amount differs from the agreed total', () => {
    expect(returnFormErrors(base)).toEqual({});
    expect(returnFormErrors({ ...base, finalPaise: 12_000 }).reason).toBe('required');
    expect(returnFormErrors({ ...base, finalPaise: 12_000, reason: 'fuel' }).reason).toBeUndefined();
  });
  it('refuses a closing hour meter below the opening one', () => {
    expect(returnFormErrors({ ...base, hourEnd: 119 }).hourEnd).toBe('belowStart');
    expect(returnFormErrors({ ...base, hourEnd: 120 }).hourEnd).toBeUndefined();
  });
});
