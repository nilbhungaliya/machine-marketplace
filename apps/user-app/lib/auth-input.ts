import { toAsciiDigits } from './digits';

/** The phone field as typed, with Gujarati/Hindi digits turned into 0–9. */
export function sanitizePhoneInput(value: string): string {
  return toAsciiDigits(value);
}

/** Keeps only digits, capped at `length`. Handles typing, paste, autofill and SMS auto-read. */
export function sanitizeOtpInput(value: string, length = 6): string {
  return toAsciiDigits(value).replace(/\D/g, '').slice(0, length);
}

// Inputs keep the raw typed text (rewriting it mid-composition makes Android
// Indic keyboards commit twice); the digits used for checks and sends are derived.
export function phoneFieldState(raw: string) {
  const digits = sanitizePhoneInput(raw);
  return { value: raw, digits, complete: digits.length === 10 };
}

export function otpFieldState(raw: string, length = 6) {
  const digits = sanitizeOtpInput(raw, length);
  return { value: raw, digits, complete: digits.length === length };
}
