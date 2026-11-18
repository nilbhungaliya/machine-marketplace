import type { ListingProblem } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import { errorCode, errorDetails, errorKey } from './api-error';

// The listing API's error codes (F2 spec §14) → translated copy, in one place (plan Task 21). Server messages are
// English and never shown. Local codes: `UPLOAD_FAILED` (a storage PUT), `PHOTO_PREPARE_FAILED`,
// `VIDEO_PREPARE_FAILED` (the manipulator / compressor, `lib/media-device.ts`).

export const LISTING_ERROR_KEYS: Record<string, string> = {
  KIND_IMMUTABLE: 'listing.errors.kindImmutable',
  FIELD_NOT_FOR_KIND: 'listing.errors.fieldNotForKind',
  CATEGORY_INVALID: 'listing.errors.categoryInvalid',
  SPECS_INVALID: 'listing.errors.specsInvalid',
  SIDE_REQUIRED: 'listing.errors.sideRequired',
  SIDE_NOT_ALLOWED: 'listing.errors.sideNotAllowed',
  UNIT_DECIMALS: 'listing.errors.unitDecimals',
  MIN_ORDER_ABOVE_QUANTITY: 'listing.errors.minOrderAboveQuantity',
  PRICE_REQUIRED: 'listing.errors.priceRequired',
  RATE_REQUIRED: 'listing.errors.rateRequired',
  BRAND_INVALID: 'listing.errors.brandInvalid',
  MODEL_INVALID: 'listing.errors.modelInvalid',
  FITMENT_INVALID: 'listing.errors.fitmentInvalid',
  AREA_MISMATCH: 'listing.errors.areaMismatch',
  LISTING_INCOMPLETE: 'listing.errors.incomplete',
  MEDIA_KEY_INVALID: 'listing.errors.mediaKeyInvalid',
  MEDIA_MISSING: 'listing.errors.mediaMissing',
  MEDIA_TYPE: 'listing.errors.mediaType',
  MEDIA_METADATA: 'listing.errors.mediaMetadata',
  MEDIA_ORDER_INVALID: 'listing.errors.mediaOrderInvalid',
  MEDIA_TOO_LARGE: 'listing.errors.mediaTooLarge',
  VIDEO_TOO_LONG: 'listing.errors.videoTooLong',
  RENTAL_NEEDS_GST: 'listing.errors.rentalNeedsGst',
  REPORT_OWN_LISTING: 'listing.errors.reportOwnListing',
  LISTING_NOT_FOUND: 'listing.errors.notFound',
  ONBOARDING_INCOMPLETE: 'listing.errors.onboardingIncomplete',
  DRAFT_LIMIT: 'listing.errors.draftLimit',
  UNVERIFIED_LISTING_CAP: 'listing.errors.unverifiedCap',
  NO_MACHINE_UNIT: 'listing.errors.noMachineUnit',
  LISTING_NOT_EDITABLE: 'listing.errors.notEditable',
  CATEGORY_LOCKED: 'listing.errors.categoryLocked',
  LISTING_TRANSITION_NOT_ALLOWED: 'listing.errors.transitionNotAllowed',
  MEDIA_LIMIT: 'listing.errors.mediaLimit',
  MEDIA_LAST_PHOTO: 'listing.errors.mediaLastPhoto',
  REPORT_EXISTS: 'listing.errors.reportExists',
  REPORT_LIMIT: 'listing.errors.reportLimit',
  STORAGE_UNAVAILABLE: 'listing.errors.storageUnavailable',
  RATE_LIMITED: 'listing.errors.rateLimited',
  UPLOAD_FAILED: 'listing.errors.uploadFailed',
  PHOTO_PREPARE_FAILED: 'listing.errors.photoPrepare',
  VIDEO_PREPARE_FAILED: 'listing.errors.videoPrepare',
};

/** The translation key for a failed listing call (network and suspension lines from `errorKey`). */
export function listingErrorKey(err: unknown): string {
  return errorKey(err, LISTING_ERROR_KEYS);
}

/** Translated copy for a failed listing call; `UNVERIFIED_LISTING_CAP` names the cap from `details.cap`. */
export function listingErrorMessage(err: unknown): string {
  const cap = errorDetails(err).cap;
  return i18n.t(listingErrorKey(err), { cap: typeof cap === 'number' ? cap : 3 });
}

/** The problems of a `400 LISTING_INCOMPLETE` (`details.problems`), else []. */
export function incompleteProblems(err: unknown): ListingProblem[] {
  if (errorCode(err) !== 'LISTING_INCOMPLETE') return [];
  const problems = errorDetails(err).problems;
  return Array.isArray(problems)
    ? problems.filter((p): p is ListingProblem => !!p && typeof p.field === 'string' && typeof p.code === 'string')
    : [];
}

/** Errors that mean "verify your GST" (the app shows the GST button with the message, §5.1). */
export function needsGstVerification(err: unknown): boolean {
  const code = errorCode(err);
  return code === 'RENTAL_NEEDS_GST' || code === 'UNVERIFIED_LISTING_CAP';
}
