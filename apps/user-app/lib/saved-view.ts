import type { ListingCard, ListingStatus, SavedListingsPage } from '@mpm/shared-types';
import { PUBLIC_LISTING_STATUSES } from '@mpm/shared-types';
import { canShowHeart, type HeartViewer } from '@/lib/saved-cache';

// Saved listings on screen (F4 + F5 spec §8.5): the Saved list's rows, Profile's "Saved (n)" count and the listing
// page's heart. Pure, so the rules are tested without React.

export type SavedRow =
  | { type: 'card'; listingId: string; card: ListingCard }
  /** No longer public (sold, removed, hidden, expired): "No longer available" and Remove, never a card. */
  | { type: 'unavailable'; listingId: string };

/** Every loaded page's items as rows, newest saved first (the API's order), each listing once. */
export function savedRows(pages: readonly SavedListingsPage[] | undefined): SavedRow[] {
  const seen = new Set<string>();
  const rows: SavedRow[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.listingId)) continue;
      seen.add(item.listingId);
      rows.push('card' in item
        ? { type: 'card', listingId: item.listingId, card: item.card }
        : { type: 'unavailable', listingId: item.listingId });
    }
  }
  return rows;
}

/**
 * Profile's "Saved (n)" from the first page: the exact number when it is the only page, else "20+" (the API has no
 * total). Null while unknown (loading, error), so the row shows just "Saved".
 */
export function savedCount(first: SavedListingsPage | undefined): { n: number; more: boolean } | null {
  if (!first) return null;
  return { n: first.items.length, more: first.nextCursor !== null };
}

/**
 * The listing page's heart: never on your own listing or on one buyers can't see (it can't be saved), shown to guests
 * (it asks them to sign in). The detail's `saved` is not computed by the API, so the state comes from the listing's
 * card (`POST /discover/cards`) once it has loaded; until then a signed-in viewer's heart waits rather than show a wrong
 * state.
 */
export function listingHeart(
  listing: Pick<ListingCard, 'businessId' | 'status' | 'saved'> & { isOwner: boolean },
  viewer: HeartViewer,
  cardSaved: boolean | null | undefined,
): { show: false } | { show: true; saved: boolean | null } {
  if (listing.isOwner) return { show: false };
  if (!(PUBLIC_LISTING_STATUSES as readonly ListingStatus[]).includes(listing.status)) return { show: false };
  if (!canShowHeart(listing, viewer)) return { show: false };
  if (!viewer.signedIn) return { show: true, saved: null };
  const saved = cardSaved ?? listing.saved;
  if (saved === null || saved === undefined) return { show: false };
  return { show: true, saved };
}
