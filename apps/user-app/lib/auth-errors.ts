import { i18n } from '@/lib/i18n';

// API error codes (apps/api/src/services/otp.service.ts, user.service.ts) → translated copy.
const AUTH_ERROR_KEY: Record<string, string> = {
  OTP_WRONG: 'errors.auth.wrongCode',
  OTP_EXPIRED: 'errors.auth.codeExpired',
  OTP_TOO_MANY_ATTEMPTS: 'errors.auth.tooManyWrongCodes',
  OTP_UNAVAILABLE: 'errors.auth.busy',
  RATE_LIMITED: 'errors.auth.tooManyAttempts',
  ACCOUNT_SUSPENDED: 'errors.auth.suspended',
  ERR_NETWORK: 'errors.network',
};

/**
 * User-facing copy for a failed OTP send/verify. Known codes get translated text;
 * anything else falls back to the API's message, then a generic retry line.
 * `lng` pins the language, e.g. 'en' for analytics properties.
 */
export function mapAuthError(error: {
  code?: string;
  message?: string;
  response?: { data?: { error?: string; code?: string } };
}, lng?: string): string {
  // A raw axios error's own `code` (ERR_BAD_REQUEST) says nothing; the API's does.
  const code = error.response?.data?.code ?? error.code;
  const key = code ? AUTH_ERROR_KEY[code] : undefined;
  if (key) return i18n.t(key, { lng });
  return error.response?.data?.error || i18n.t('errors.genericRetry', { lng });
}

/** The stable code for analytics `reason` properties. */
export function authErrorCode(error: { code?: string; response?: { data?: { code?: string } } }): string {
  return error.response?.data?.code ?? error.code ?? 'UNKNOWN';
}
