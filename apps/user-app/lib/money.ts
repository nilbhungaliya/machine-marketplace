import { toAsciiDigits } from './digits';

// Rupees typed by a seller ↔ integer paise (F2 spec §4.6, §15.4; CLAUDE.md "Money: integer paise everywhere, never
// floats"). Pure. Grouping is Indian (lakh / crore) and done by hand: Hermes ships different Intl data per platform.

const RUPEES_RE = /^(\d{1,13})(?:\.(\d{0,2}))?$/;

/**
 * Typed rupees → paise, or null when it isn't a valid amount. Accepts Hindi and Gujarati digits, a leading ₹, spaces
 * and any `,` grouping, and up to 2 decimals: `१,२३,४५६.५` → 12345650; `4.567` → null. Range checks (₹1 minimum,
 * ₹100 crore maximum) are the form's, not this function's.
 */
export function parseRupees(text: string): number | null {
  const clean = toAsciiDigits(text).replace(/[₹,\s]/g, '');
  const m = RUPEES_RE.exec(clean);
  if (!m) return null;
  const rupees = Number(m[1]);
  const paise = Number((m[2] ?? '').padEnd(2, '0'));
  const total = rupees * 100 + paise;
  return Number.isSafeInteger(total) ? total : null;
}

/** `1234567` → `12,34,567` (the last three digits, then pairs). */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** Paise → `₹1,23,456`, or `₹1,23,456.50` when there are paise. */
export function formatRupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}₹${groupIndian(String(rupees))}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

/** Paise → the text an input is prefilled with (`123456`, `123456.50`), without ₹ or grouping. */
export function rupeesInput(paise: number | null | undefined): string {
  if (paise == null) return '';
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest ? `${rupees}.${String(rest).padStart(2, '0')}` : String(rupees);
}
