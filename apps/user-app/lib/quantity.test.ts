import { describe, expect, it } from 'vitest';
import { formatQuantity, parseMachineCount, parseQuantity } from './quantity';

describe('parseQuantity', () => {
  it('a unit with 0 decimals refuses 1.5', () => {
    expect(parseQuantity('1.5', 0)).toEqual({ ok: false, problem: 'decimals' });
    expect(parseQuantity('15', 0)).toEqual({ ok: true, value: '15' });
  });
  it('allows the unit decimals, trims trailing zeros and grouping', () => {
    expect(parseQuantity('2.125', 3)).toEqual({ ok: true, value: '2.125' });
    expect(parseQuantity('1,200.50', 2)).toEqual({ ok: true, value: '1200.5' });
    expect(parseQuantity('2.50', 1)).toEqual({ ok: true, value: '2.5' });
    expect(parseQuantity('007', 0)).toEqual({ ok: true, value: '7' });
    expect(parseQuantity('૧૪', 0)).toEqual({ ok: true, value: '14' });
  });
  it('refuses zero, empty, text and too large', () => {
    expect(parseQuantity('0', 0)).toEqual({ ok: false, problem: 'zero' });
    expect(parseQuantity(' ', 0)).toEqual({ ok: false, problem: 'empty' });
    expect(parseQuantity('a1', 0)).toEqual({ ok: false, problem: 'invalid' });
    expect(parseQuantity('1000001', 0)).toEqual({ ok: false, problem: 'tooLarge' });
  });
  it('machines: whole numbers 1–1000', () => {
    expect(parseMachineCount('3')).toEqual({ ok: true, value: '3' });
    expect(parseMachineCount('1001')).toEqual({ ok: false, problem: 'tooLarge' });
    expect(parseMachineCount('1.5')).toEqual({ ok: false, problem: 'decimals' });
  });
});

describe('formatQuantity', () => {
  it('Indian grouping, trailing zeros dropped', () => {
    expect(formatQuantity('120000.5')).toBe('1,20,000.5');
    expect(formatQuantity('14.000')).toBe('14');
    expect(formatQuantity(null)).toBe('');
  });
});
