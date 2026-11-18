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

/** Your business and Where are you? (F1), in onboarding and in edit mode (`mode`). */
export const ONBOARDING_EVENTS = {
  profileSaved: 'onboarding_profile_saved',
  profileSaveFailed: 'onboarding_profile_save_failed',
  locationDetected: 'onboarding_location_detected',
  locationDetectFailed: 'onboarding_location_detect_failed',
  locationSaved: 'onboarding_location_saved',
  locationSaveFailed: 'onboarding_location_save_failed',
  gstIntroShown: 'onboarding_gst_intro_shown',
  gstIntroSkipped: 'onboarding_gst_intro_skipped',
  gstIntroAccepted: 'onboarding_gst_intro_accepted',
} as const;

/** GST verification (F1 spec §5): instant path (lookup → declare → code) and the review path (documents). */
export const GST_EVENTS = {
  lookupCompleted: 'gst_lookup_completed',
  lookupFailed: 'gst_lookup_failed',
  codeSent: 'gst_code_sent',
  codeSendFailed: 'gst_code_send_failed',
  verified: 'gst_verified',
  verifyFailed: 'gst_verify_failed',
  reviewOpened: 'gst_review_opened',
  reviewSubmitted: 'gst_review_submitted',
  reviewSubmitFailed: 'gst_review_submit_failed',
  filesAdded: 'gst_files_added',
  filesAddFailed: 'gst_files_add_failed',
} as const;

export const SETTINGS_EVENTS = {
  languageChanged: 'settings_language_changed',
  themeChanged: 'settings_theme_changed',
} as const;

/**
 * Route params allowed onto screen events. Everything else is dropped, so a param
 * carrying a phone or a price never reaches analytics by accident.
 */
export const SCREEN_PARAM_ALLOWLIST = ['listingId', 'partRequestId', 'dealId', 'category', 'mode'] as const;

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
