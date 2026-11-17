import { describe, it, expect } from 'vitest';
import { toAsciiDigits } from './digits';

describe('toAsciiDigits', () => {
  it('maps Gujarati digits', () => {
    expect(toAsciiDigits('૦૧૨૩૪૫૬૭૮૯')).toBe('0123456789');
  });

  it('maps Devanagari (Hindi) digits', () => {
    expect(toAsciiDigits('०१२३४५६७८९')).toBe('0123456789');
  });

  it('leaves letters, spaces, dashes and ASCII digits where they are', () => {
    expect(toAsciiDigits('gj ૦૫ ab-१२3૪')).toBe('gj 05 ab-1234');
  });

  it('does not touch Gujarati or Hindi letters', () => {
    expect(toAsciiDigits('જીજે૦૧ गुज')).toBe('જીજે01 गुज');
  });

  it('returns an empty string unchanged', () => {
    expect(toAsciiDigits('')).toBe('');
  });

  it('returns already-ASCII text unchanged', () => {
    expect(toAsciiDigits('GJ05AB1234')).toBe('GJ05AB1234');
  });
});
