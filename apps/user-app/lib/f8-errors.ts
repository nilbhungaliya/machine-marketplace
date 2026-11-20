import { PART_REQUEST_ERROR_CODES } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import { errorKey } from './api-error';
import { F6_ERROR_KEYS } from './f6-errors';

// The F8 error codes (spec §15) → translated copy (`errors.requests.*`). Server messages are English and never shown.
// Codes F8 shares with F2 / F6 (`VIEWER_READ_ONLY`, `TOO_MANY_PHOTOS`, `PHOTO_INVALID`, `RATE_LIMITED`, …) keep their
// copy (`F6_ERROR_KEYS`); F8's own `REPLY_EXISTS` (a reply on that listing already) overrides F6's (a review reply).

/** `PART_REQUEST_OPEN_LIMIT` → `errors.requests.partRequestOpenLimit`. */
const keyOf = (code: string): string =>
  `errors.requests.${code.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`;

export const F8_ERROR_KEYS: Record<string, string> = {
  ...F6_ERROR_KEYS,
  ...Object.fromEntries(PART_REQUEST_ERROR_CODES.map((code) => [code, keyOf(code)])),
};

/** The translation key for a failed part-request call (network and suspension lines from `errorKey`). */
export function f8ErrorKey(err: unknown): string {
  return errorKey(err, F8_ERROR_KEYS);
}

export function f8ErrorMessage(err: unknown): string {
  return i18n.t(f8ErrorKey(err));
}
