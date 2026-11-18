import { describe, expect, it } from 'vitest';
import { isValidGstin, normalizeGstin, panFromGstin, stateCodeFromGstin } from '@mpm/shared-types';

// The shared-types package has no test runner, so its GSTIN helpers are tested here.
// 24AAACC0000C1ZY is textile's stub GSTIN: right format and a correct check digit.
const STUB_GSTIN = '24AAACC0000C1ZY';

describe('isValidGstin', () => {
  it('accepts a GSTIN with the right format and check digit', () => {
    expect(isValidGstin(STUB_GSTIN)).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidGstin('24AAACC0000C1ZX')).toBe(false);
  });

  it('rejects lower-case input until it is normalised', () => {
    expect(isValidGstin('24aaacc0000c1zy')).toBe(false);
    expect(isValidGstin(normalizeGstin('24aaacc0000c1zy'))).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isValidGstin(STUB_GSTIN.slice(0, 14))).toBe(false);
  });
});

describe('normalizeGstin', () => {
  it('upper-cases and strips every space', () => {
    expect(normalizeGstin(' 24aaacc0000c1zy ')).toBe(STUB_GSTIN);
    expect(normalizeGstin('24aaa cc0000\tc1zy')).toBe(STUB_GSTIN);
  });
});

describe('panFromGstin / stateCodeFromGstin', () => {
  it('takes the PAN from characters 3-12 and the state code from 1-2', () => {
    expect(panFromGstin(STUB_GSTIN)).toBe('AAACC0000C');
    expect(stateCodeFromGstin(STUB_GSTIN)).toBe('24');
  });
});
