import { describe, expect, it } from 'vitest';
import { otpCells } from './otp-cells';

// The six login-code cells (spec §7.1, §7.6): drawn from the raw text of the one real TextInput.

const states = (raw: string, length = 6) => otpCells(raw, length).map((c) => c.state);
const chars = (raw: string, length = 6) => otpCells(raw, length).map((c) => c.char);

describe('otpCells', () => {
  it('marks the first cell current when empty', () => {
    expect(states('')).toEqual(['current', 'empty', 'empty', 'empty', 'empty', 'empty']);
    expect(chars('')).toEqual(['', '', '', '', '', '']);
  });

  it('fills typed digits and moves current to the next cell', () => {
    expect(states('48')).toEqual(['filled', 'filled', 'current', 'empty', 'empty', 'empty']);
    expect(chars('48').slice(0, 2)).toEqual(['4', '8']);
  });

  it('shows Hindi and Gujarati digits as 0-9', () => {
    expect(chars('४८१').slice(0, 3)).toEqual(['4', '8', '1']);
    expect(chars('૪૮૧').slice(0, 3)).toEqual(['4', '8', '1']);
  });

  it('keeps the last cell current when complete', () => {
    expect(states('481936')).toEqual(['filled', 'filled', 'filled', 'filled', 'filled', 'current']);
    expect(chars('481936')).toEqual(['4', '8', '1', '9', '3', '6']);
  });

  it('ignores spaces and other characters in a pasted code', () => {
    expect(states('48 19')).toEqual(['filled', 'filled', 'filled', 'filled', 'current', 'empty']);
    expect(chars('48 19').slice(0, 4)).toEqual(['4', '8', '1', '9']);
    expect(chars('481 936 99')).toEqual(['4', '8', '1', '9', '3', '6']);
  });

  it('follows the length', () => {
    expect(otpCells('12', 4)).toHaveLength(4);
  });
});
