import { describe, expect, it } from 'vitest';
import { assertInt4Paise, moneyStringToPaise } from './money.js';

describe('moneyStringToPaise', () => {
  it('converts exact rupee strings without floating point', () => {
    expect(moneyStringToPaise('62')).toBe(6200);
    expect(moneyStringToPaise('149.5')).toBe(14950);
    expect(moneyStringToPaise('0.07')).toBe(7);
  });

  it('rejects anything that is not a plain rupee amount', () => {
    expect(() => moneyStringToPaise('1.234')).toThrow();
    expect(() => moneyStringToPaise('-5')).toThrow();
    expect(() => moneyStringToPaise('₹5')).toThrow();
  });
});

describe('assertInt4Paise', () => {
  it('passes safe non-negative integers that fit an int4 column', () => {
    expect(assertInt4Paise(0)).toBe(0);
    expect(assertInt4Paise(2_147_483_647)).toBe(2_147_483_647);
  });

  it('rejects fractions, negatives and overflow', () => {
    expect(() => assertInt4Paise(1.5)).toThrow();
    expect(() => assertInt4Paise(-1)).toThrow();
    expect(() => assertInt4Paise(2_147_483_648)).toThrow();
  });
});
