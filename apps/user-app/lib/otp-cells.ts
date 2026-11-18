import { otpFieldState } from './auth-input';

// The login code's cells (spec §7.1 OtpCells): one real TextInput keeps the raw text (autofill, paste, Hindi /
// Gujarati digits), and the cells are drawn from it. Pure.

export type OtpCellState = 'filled' | 'current' | 'empty';
export interface OtpCell {
  char: string;
  state: OtpCellState;
}

/** The first empty cell is `current`; when every cell is filled, the last one is. */
export function otpCells(raw: string, length: number): OtpCell[] {
  const { digits } = otpFieldState(raw, length);
  const current = Math.min(digits.length, length - 1);
  return Array.from({ length }, (_, i) => ({
    char: digits[i] ?? '',
    state: i === current ? 'current' : i < digits.length ? 'filled' : 'empty',
  }));
}
