import { describe, expect, it } from 'vitest';
import { i18n } from '@/lib/i18n';
import {
  incompleteProblems, LISTING_ERROR_KEYS, listingErrorKey, listingErrorMessage, needsGstVerification,
} from './listing-errors';

const apiError = (status: number, code: string, details?: Record<string, unknown>) => ({
  response: { status, data: { error: 'English message', code, details } },
});

describe('listing errors', () => {
  it('every code has an en key', () => {
    for (const [code, key] of Object.entries(LISTING_ERROR_KEYS)) expect(i18n.exists(key), code).toBe(true);
  });
  it('covers the codes the app shows', () => {
    for (const code of ['RENTAL_NEEDS_GST', 'UNVERIFIED_LISTING_CAP', 'CATEGORY_LOCKED', 'MEDIA_METADATA', 'MEDIA_TYPE', 'STORAGE_UNAVAILABLE']) {
      expect(LISTING_ERROR_KEYS[code], code).toBeDefined();
    }
  });
  it('maps a code, the network and anything else', () => {
    expect(listingErrorKey(apiError(409, 'CATEGORY_LOCKED'))).toBe('listing.errors.categoryLocked');
    expect(listingErrorKey({ code: 'ERR_NETWORK' })).toBe('errors.network');
    expect(listingErrorKey(apiError(500, 'INTERNAL'))).toBe('errors.genericRetry');
  });
  it('the cap message names the cap', () => {
    expect(listingErrorMessage(apiError(409, 'UNVERIFIED_LISTING_CAP', { cap: 3 }))).toBe('Verify your GST to list more than 3 listings.');
    expect(listingErrorMessage(apiError(503, 'STORAGE_UNAVAILABLE'))).toBe("Photo upload isn't available yet.");
  });
  it('reads LISTING_INCOMPLETE problems', () => {
    const err = apiError(400, 'LISTING_INCOMPLETE', { problems: [{ field: 'photos', code: 'required' }, { bad: 1 }] });
    expect(incompleteProblems(err)).toEqual([{ field: 'photos', code: 'required' }]);
    expect(incompleteProblems(apiError(400, 'SPECS_INVALID'))).toEqual([]);
  });
  it('GST errors', () => {
    expect(needsGstVerification(apiError(403, 'RENTAL_NEEDS_GST'))).toBe(true);
    expect(needsGstVerification(apiError(409, 'UNVERIFIED_LISTING_CAP'))).toBe(true);
    expect(needsGstVerification(apiError(409, 'DRAFT_LIMIT'))).toBe(false);
  });
});
