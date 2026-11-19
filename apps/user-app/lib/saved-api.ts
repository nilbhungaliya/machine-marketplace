import type { ApiSuccess, SavedListingsPage, SaveListingResult } from '@mpm/shared-types';
import api from './api';

// Saved listings (F4 + F5 spec §4.4, §7, `apps/api/src/routes/saved-listings.ts`): signed-in only. PUT is idempotent;
// `404 LISTING_NOT_FOUND` (not public), `409 CANNOT_SAVE_OWN_LISTING`, `409 SAVED_LIMIT`. DELETE always answers
// `{ saved: false }`.

const data = <T>(p: Promise<{ data: ApiSuccess<T> }>): Promise<T> => p.then((r) => r.data.data);

export function fetchSavedListings(cursor?: string | null): Promise<SavedListingsPage> {
  return data(api.get<ApiSuccess<SavedListingsPage>>('/users/me/saved-listings', { params: cursor ? { cursor } : {} }));
}

export function saveListing(listingId: string): Promise<SaveListingResult> {
  return data(api.put<ApiSuccess<SaveListingResult>>(`/users/me/saved-listings/${listingId}`));
}

export function unsaveListing(listingId: string): Promise<SaveListingResult> {
  return data(api.delete<ApiSuccess<SaveListingResult>>(`/users/me/saved-listings/${listingId}`));
}
