import { describe, expect, it } from 'vitest';
import { formatRupees, groupIndian, parseRupees, rupeesInput } from './money';

describe('parseRupees', () => {
  it('accepts Hindi digits with Indian grouping and one decimal', () => {
    expect(parseRupees('१,२३,४५६.५')).toBe(12345650);
  });
  it('accepts Gujarati digits, ₹, spaces', () => {
    expect(parseRupees('₹ ૪૨૦')).toBe(42000);
    expect(parseRupees(' 1,000.05 ')).toBe(100005);
    expect(parseRupees('7.')).toBe(700);
  });
  it('refuses more than 2 decimals, text and empty', () => {
    expect(parseRupees('4.567')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
    expect(parseRupees('')).toBeNull();
    expect(parseRupees('-5')).toBeNull();
    expect(parseRupees('1.2.3')).toBeNull();
  });
});

describe('formatRupees', () => {
  it('groups in lakh / crore', () => {
    expect(formatRupees(12345600)).toBe('₹1,23,456');
    expect(formatRupees(42000)).toBe('₹420');
    expect(formatRupees(1_000_000_000)).toBe('₹1,00,00,000');
    expect(formatRupees(12345650)).toBe('₹1,23,456.50');
    expect(formatRupees(5)).toBe('₹0.05');
  });
  it('groupIndian', () => {
    expect(groupIndian('999')).toBe('999');
    expect(groupIndian('1000')).toBe('1,000');
    expect(groupIndian('1234567')).toBe('12,34,567');
  });
  it('rupeesInput round-trips with parseRupees', () => {
    expect(rupeesInput(12345650)).toBe('123456.50');
    expect(rupeesInput(42000)).toBe('420');
    expect(rupeesInput(null)).toBe('');
    expect(parseRupees(rupeesInput(12345650))).toBe(12345650);
  });
});
