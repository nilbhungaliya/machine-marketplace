import { i18n } from '@/lib/i18n';
import { errorKey } from './api-error';
import { LISTING_ERROR_KEYS } from './listing-errors';

// The F6 + F7 error codes (spec §18) → translated copy (`errors.trade.*`). Server messages are English and never shown.
// F2's codes it reuses (`LISTING_NOT_FOUND`, `REPORT_EXISTS`, `REPORT_LIMIT`, `STORAGE_UNAVAILABLE`, `RATE_LIMITED`,
// `ONBOARDING_INCOMPLETE`) keep their F2 copy (`LISTING_ERROR_KEYS`).

export const F6_ERROR_CODES = [
  'OWN_LISTING', 'VIEWER_READ_ONLY', 'BUSINESS_BLOCKED', 'BLOCK_SELF', 'ENQUIRY_LIMIT', 'THREAD_NOT_FOUND',
  'PHOTO_INVALID', 'PHOTO_KEY_INVALID', 'TOO_MANY_PHOTOS', 'MESSAGE_EMPTY', 'OFFERS_NOT_FOR_RENTALS',
  'PRICE_MODEL_MISMATCH', 'QUOTE_NOT_ALLOWED', 'NEGOTIATION_OPEN', 'OFFER_NOT_FOUND', 'OFFER_LIMIT_REACHED',
  'PRICE_ABOVE_ASKING', 'QUANTITY_BELOW_MINIMUM', 'QUANTITY_NOT_AVAILABLE', 'QUANTITY_DECIMALS', 'COUNTER_OUT_OF_BOUNDS',
  'COUNTER_UNCHANGED', 'COUNTER_LIMIT', 'COUNTER_NOT_ALLOWED', 'NOT_YOUR_TURN', 'OFFER_NOT_OPEN', 'OFFER_EXPIRED',
  'OFFER_NEEDS_RECONFIRM', 'DEAL_NOT_FOUND', 'DEAL_STALE', 'DEAL_TRANSITION_NOT_ALLOWED', 'PROBLEM_WINDOW_CLOSED',
  'CANCEL_REQUEST_EXISTS', 'NO_CANCEL_REQUEST', 'LISTING_HAS_OPEN_DEALS', 'QUANTITY_BELOW_HELD', 'QUANTITY_REQUIRED',
  'UNIT_LOCKED', 'OWNER_CONSENT_REQUIRED', 'OWNER_ONLY', 'CONTACT_PHONE_INVALID', 'REVIEW_NOT_ELIGIBLE',
  'REVIEW_WINDOW_CLOSED', 'REVIEW_EXISTS', 'REVIEW_ANSWERS_INVALID', 'REVIEW_NOT_FOUND', 'REVIEW_NOT_PUBLISHED',
  'REPLY_EXISTS', 'DISPUTE_NOT_OPEN', 'ADMIN_READ_NOT_ALLOWED', 'IDEMPOTENCY_KEY_REUSED', 'REQUEST_IN_PROGRESS',
] as const;
export type F6ErrorCode = (typeof F6_ERROR_CODES)[number];

/** `OFFER_LIMIT_REACHED` → `errors.trade.offerLimitReached`. */
const keyOf = (code: string): string =>
  `errors.trade.${code.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`;

export const F6_ERROR_KEYS: Record<string, string> = {
  ...LISTING_ERROR_KEYS,
  ...Object.fromEntries(F6_ERROR_CODES.map((code) => [code, keyOf(code)])),
};

/** The translation key for a failed chat / offer / deal / review call (network and suspension lines from `errorKey`). */
export function f6ErrorKey(err: unknown): string {
  return errorKey(err, F6_ERROR_KEYS);
}

export function f6ErrorMessage(err: unknown): string {
  return i18n.t(f6ErrorKey(err));
}
