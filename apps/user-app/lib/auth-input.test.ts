import { describe, it, expect } from 'vitest';
import { sanitizePhoneInput, sanitizeOtpInput, phoneFieldState, otpFieldState } from './auth-input';

describe('sanitizePhoneInput', () => {
  it('turns a Gujarati-typed number into ten ASCII digits', () => {
    expect(sanitizePhoneInput('૯૮૭૬૫૪૩૨૧૦')).toBe('9876543210');
  });

  it('turns a Hindi-typed number into ten ASCII digits', () => {
    expect(sanitizePhoneInput('९८७६५४३२१०')).toBe('9876543210');
  });

  it('leaves an ASCII number exactly as typed', () => {
    expect(sanitizePhoneInput('9876543210')).toBe('9876543210');
    expect(sanitizePhoneInput('98765')).toBe('98765');
  });
});

describe('sanitizeOtpInput', () => {
  it('keeps six Gujarati or Hindi digits as ASCII', () => {
    expect(sanitizeOtpInput('૧૨૩૪૫૬')).toBe('123456');
    expect(sanitizeOtpInput('१२३४५६')).toBe('123456');
  });

  it('drops non-digits and caps at six, as before', () => {
    expect(sanitizeOtpInput('12-34 56 78')).toBe('123456');
    expect(sanitizeOtpInput('1a2')).toBe('12');
  });
});

// The inputs keep the raw typed text (see plateFieldState for why); these derive the rest.
describe('phoneFieldState', () => {
  it('keeps the value raw, derives ASCII, and is complete at ten Gujarati digits', () => {
    expect(phoneFieldState('૯૮૭૬૫૪૩૨૧૦')).toEqual({ value: '૯૮૭૬૫૪૩૨૧૦', digits: '9876543210', complete: true });
    expect(phoneFieldState('९८७६५').complete).toBe(false);
    expect(phoneFieldState('9876543210').complete).toBe(true);
  });
});

describe('otpFieldState', () => {
  it('keeps the value raw, derives ASCII, and is complete at six Hindi digits', () => {
    expect(otpFieldState('१२३४५६')).toEqual({ value: '१२३४५६', digits: '123456', complete: true });
    expect(otpFieldState('૧૨૩').complete).toBe(false);
  });
});
