import type { ListingCard } from '@mpm/shared-types';

// The heart's optimistic update (F4 + F5 spec §8.4, §8.5): one pure reducer that sets `saved` on every cached copy of a
// listing's card, whatever the shape around it (a card list, infinite search pages, the home view, the saved list, the
// listing page). Unchanged branches keep their references, so React Query only re-renders what changed.

function isCard(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string' && typeof value.ref === 'number' && 'saved' in value;
}

/** `data` with `saved` set on every card of `listingId`; the same reference when nothing changed. */
export function patchSaved<T>(data: T, listingId: string, saved: boolean): T {
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    let changed = false;
    const next = data.map((item) => {
      const patched = patchSaved(item, listingId, saved);
      if (patched !== item) changed = true;
      return patched;
    });
    return (changed ? next : data) as T;
  }
  const obj = data as Record<string, unknown>;
  if (isCard(obj) && obj.id === listingId) {
    return (obj.saved === saved ? data : { ...obj, saved }) as T;
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const patched = value !== null && typeof value === 'object' ? patchSaved(value, listingId, saved) : value;
    if (patched !== value) changed = true;
    next[key] = patched;
  }
  return (changed ? next : data) as T;
}

/**
 * Who is looking, for the heart: a guest, or a signed-in viewer whose business id is `undefined` while it loads (`null`
 * = no business yet).
 */
export type HeartViewer = { signedIn: false } | { signedIn: true; businessId: string | null | undefined };

/**
 * The heart shows for guests (it asks them to sign in) and on other businesses' listings, never on your own. For a
 * signed-in viewer it waits until the business is known, so it never flashes on an own listing.
 */
export function canShowHeart(card: Pick<ListingCard, 'businessId'>, viewer: HeartViewer): boolean {
  if (!viewer.signedIn) return true;
  if (viewer.businessId === undefined) return false;
  return viewer.businessId === null || card.businessId !== viewer.businessId;
}
