import { toAsciiDigits } from './digits';
import { groupIndian } from './money';

// Quantities as the API takes them: decimal strings, > 0, ≤ 1 000 000, no more decimals than the unit allows
// (F2 spec §4.2, `400 UNIT_DECIMALS`). Machines and rentals: whole numbers 1–1000. Pure.

export const QUANTITY_MAX = 1_000_000;
export const MACHINE_QUANTITY_MAX = 1000;

export type QuantityProblem = 'empty' | 'invalid' | 'decimals' | 'zero' | 'tooLarge';

export type QuantityResult = { ok: true; value: string } | { ok: false; problem: QuantityProblem };

/**
 * Typed quantity → the API's decimal string (`" 1,200.50 "` → `"1200.5"`), with the reason it was refused otherwise.
 * Hindi and Gujarati digits are accepted. `decimals` is the unit's (0 for pieces, machines).
 */
export function parseQuantity(text: string, decimals: number, max: number = QUANTITY_MAX): QuantityResult {
  const clean = toAsciiDigits(text).replace(/[,\s]/g, '');
  if (clean === '') return { ok: false, problem: 'empty' };
  const m = /^(\d{1,7})(?:\.(\d+))?$/.exec(clean);
  if (!m) return { ok: false, problem: 'invalid' };
  const int = m[1]!.replace(/^0+(?=\d)/, '');
  const frac = (m[2] ?? '').replace(/0+$/, '');
  if (frac.length > Math.min(decimals, 3)) return { ok: false, problem: 'decimals' };
  const value = frac ? `${int}.${frac}` : int;
  const n = Number(value);
  if (n <= 0) return { ok: false, problem: 'zero' };
  if (n > max) return { ok: false, problem: 'tooLarge' };
  return { ok: true, value };
}

/** A whole number of machines, 1–1000 (§4.2). */
export function parseMachineCount(text: string): QuantityResult {
  return parseQuantity(text, 0, MACHINE_QUANTITY_MAX);
}

/** The API's decimal string → display (`"120000.5"` → `"1,20,000.5"`); trailing zeros dropped. */
export function formatQuantity(q: string | number | null | undefined): string {
  if (q == null || q === '') return '';
  const [int = '0', frac = ''] = String(q).split('.');
  const f = frac.replace(/0+$/, '');
  return `${groupIndian(int)}${f ? `.${f}` : ''}`;
}
