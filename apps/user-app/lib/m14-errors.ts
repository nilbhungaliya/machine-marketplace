import { RENTAL_ERROR_CODES } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import { errorKey } from './api-error';
import { F6_ERROR_KEYS } from './f6-errors';

// The M14 error codes (spec §17) → translated copy (`rentals.errors.*`). Server messages are English and never shown.
// Codes M14 shares with F2 / F6 (`RENTAL_NEEDS_GST`, `PINCODE_UNKNOWN`, `OWN_LISTING`, `VIEWER_READ_ONLY`,
// `BUSINESS_BLOCKED`, `NO_DEAL_IN_THREAD`, `TOO_MANY_PHOTOS`, `RATE_LIMITED`, …) keep their copy (`F6_ERROR_KEYS`, which
// includes F2's `LISTING_ERROR_KEYS`).

/** `RENTAL_DATES_TAKEN` → `rentals.errors.rentalDatesTaken`. */
const keyOf = (code: string): string =>
  `rentals.errors.${code.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`;

export const M14_ERROR_KEYS: Record<string, string> = {
  ...F6_ERROR_KEYS,
  ...Object.fromEntries(RENTAL_ERROR_CODES.map((code) => [code, keyOf(code)])),
};

/** The translation key for a failed rental call (network and suspension lines from `errorKey`). */
export function m14ErrorKey(err: unknown): string {
  return errorKey(err, M14_ERROR_KEYS);
}

export function m14ErrorMessage(err: unknown): string {
  return i18n.t(m14ErrorKey(err));
}
