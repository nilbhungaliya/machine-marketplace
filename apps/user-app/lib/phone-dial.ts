import { sanitizePhoneInput } from './auth-input';

/** The national number's length: an Indian mobile has 10 digits. */
export const PHONE_DIAL_MAX = 10;

/**
 * How many digits of the 10-digit mobile number are in the phone field, for the dial gauge on the Mobile number
 * screen (mockup 02). Reads the raw field text as typed (Hindi / Gujarati digits count, through
 * `sanitizePhoneInput`); a country code doesn't count: `+91` (or a partial `+9`) after a leading `+`, and a typed
 * `91` / `0` trunk prefix once the digits run past ten (as `normalizeMobile` reads them). Capped at 10.
 */
export function phoneDialDigits(raw: string): number {
  const ascii = sanitizePhoneInput(raw).trim();
  let digits = ascii.replace(/\D/g, '');
  if (ascii.startsWith('+')) {
    // "+", "+9", "+91…": the first two digits after the plus are the country code.
    if (digits.startsWith('91')) digits = digits.slice(2);
    else if (digits === '9') digits = '';
  } else if (digits.length > PHONE_DIAL_MAX) {
    if (digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.startsWith('0')) digits = digits.slice(1);
  }
  return Math.min(PHONE_DIAL_MAX, digits.length);
}
