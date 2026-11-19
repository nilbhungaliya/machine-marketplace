import { describe, expect, it } from 'vitest';
import { phoneDialDigits } from './phone-dial';

describe('phoneDialDigits', () => {
  it('counts the digits typed so far', () => {
    expect(phoneDialDigits('')).toBe(0);
    expect(phoneDialDigits('9')).toBe(1);
    expect(phoneDialDigits('98250')).toBe(5);
    expect(phoneDialDigits('98250 41736')).toBe(10);
  });

  it('counts Hindi and Gujarati digits', () => {
    expect(phoneDialDigits('९८२५०')).toBe(5);
    expect(phoneDialDigits('૯૮૨૫૦૪૧૭૩૬')).toBe(10);
    expect(phoneDialDigits('98२५०')).toBe(5);
  });

  it('does not count a typed +91', () => {
    expect(phoneDialDigits('+')).toBe(0);
    expect(phoneDialDigits('+9')).toBe(0);
    expect(phoneDialDigits('+91')).toBe(0);
    expect(phoneDialDigits('+91 98250')).toBe(5);
    expect(phoneDialDigits('+91 98250 41736')).toBe(10);
    expect(phoneDialDigits('+९१ ९८२५०')).toBe(5);
  });

  it('drops a 91 or 0 prefix once the number runs past ten digits', () => {
    expect(phoneDialDigits('919825041736')).toBe(10);
    expect(phoneDialDigits('09825041736')).toBe(10);
    expect(phoneDialDigits('91982504173')).toBe(9);
  });

  it('caps at ten', () => {
    expect(phoneDialDigits('98250417361234')).toBe(10);
    expect(phoneDialDigits('+91 98250 4173612')).toBe(10);
  });
});
