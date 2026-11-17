import { describe, expect, it } from 'vitest';
import { isValidMobile, normalizeMobile } from './phone';

describe('normalizeMobile', () => {
  it('strips formatting and +91 / 0 prefixes', () => {
    expect(normalizeMobile('+91 98250 12345')).toBe('9825012345');
    expect(normalizeMobile('09825012345')).toBe('9825012345');
    expect(normalizeMobile('98250-12345')).toBe('9825012345');
  });
});

describe('isValidMobile', () => {
  it('accepts 10 digits starting 6–9', () => {
    expect(isValidMobile('9825012345')).toBe(true);
    expect(isValidMobile('+919825012345')).toBe(true);
  });

  it('rejects short numbers and invalid leading digits', () => {
    expect(isValidMobile('982501234')).toBe(false);
    expect(isValidMobile('5825012345')).toBe(false);
  });
});
