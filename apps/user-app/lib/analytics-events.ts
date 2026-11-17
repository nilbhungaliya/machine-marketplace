/**
 * Every custom event, grouped by area. Dashboards and funnels are built on these,
 * never on autocapture. Names: snake_case `<area>_<thing>_<past tense>`.
 *
 * Adding a feature? Add its group here (LISTING_EVENTS, OFFER_EVENTS, DEAL_EVENTS…)
 * in the same change. Track the start, the success, the failure (with a `reason`)
 * and the drop-off. Never put personal data in properties: no phone, GSTIN, PAN,
 * bank details, address or chat text — ids, counts, statuses and amounts only.
 */

export const AUTH_EVENTS = {
  otpRequested: 'auth_otp_requested',
  otpRequestFailed: 'auth_otp_request_failed',
  otpVerified: 'auth_otp_verified',
  otpVerifyFailed: 'auth_otp_verify_failed',
  onboardingCompleted: 'auth_onboarding_completed',
  loggedOut: 'auth_logged_out',
} as const;

export const SETTINGS_EVENTS = {
  languageChanged: 'settings_language_changed',
  themeChanged: 'settings_theme_changed',
} as const;

/**
 * Route params allowed onto screen events. Everything else is dropped, so a param
 * carrying a phone or a price never reaches analytics by accident.
 */
export const SCREEN_PARAM_ALLOWLIST = ['listingId', 'partRequestId', 'dealId', 'category'] as const;

export function pickAllowedParams(params: unknown): Record<string, string | number> {
  if (!params || typeof params !== 'object') return {};
  const source = params as Record<string, unknown>;
  const out: Record<string, string | number> = {};
  for (const key of SCREEN_PARAM_ALLOWLIST) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
  }
  return out;
}
