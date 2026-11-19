import { describe, expect, it } from 'vitest';
import type { ListingCard, ListingStatus, SavedListingsPage } from '@mpm/shared-types';
import { listingHeart, savedCount, savedRows } from './saved-view';

const card = (id: string): ListingCard => ({ id, businessId: 'seller', saved: true } as ListingCard);

describe('saved rows (spec §8.5)', () => {
  it('maps public items to cards and the rest to "No longer available", across pages, each listing once', () => {
    const pages: SavedListingsPage[] = [
      { items: [{ listingId: 'a', savedAt: 't', card: card('a') }, { listingId: 'b', savedAt: 't', unavailable: true }], nextCursor: 'c' },
      // A save toggled while paging can repeat a row on the next page.
      { items: [{ listingId: 'a', savedAt: 't', card: card('a') }, { listingId: 'c', savedAt: 't', card: card('c') }], nextCursor: null },
    ];
    expect(savedRows(pages).map((r) => [r.type, r.listingId])).toEqual([['card', 'a'], ['unavailable', 'b'], ['card', 'c']]);
  });

  it('counts the first page exactly, or as "n+" when more pages exist', () => {
    expect(savedCount(undefined)).toBeNull();
    expect(savedCount({ items: [], nextCursor: null })).toEqual({ n: 0, more: false });
    expect(savedCount({ items: [{ listingId: 'b', savedAt: 't', unavailable: true }], nextCursor: 'x' })).toEqual({ n: 1, more: true });
  });
});

describe('listing page heart (spec §8.5)', () => {
  const listing = (over: Partial<{ isOwner: boolean; status: ListingStatus; saved: boolean | null; businessId: string }> = {}) => ({
    isOwner: false, status: 'live' as ListingStatus, saved: null, businessId: 'seller', ...over,
  });
  const me = { signedIn: true as const, businessId: 'mine' };

  it('never shows on your own listing or one buyers cannot see', () => {
    expect(listingHeart(listing({ isOwner: true }), me, true)).toEqual({ show: false });
    expect(listingHeart(listing({ businessId: 'mine' }), me, false)).toEqual({ show: false });
    expect(listingHeart(listing({ status: 'paused' }), me, false)).toEqual({ show: false });
  });

  it('shows empty for a guest (it asks to sign in)', () => {
    expect(listingHeart(listing(), { signedIn: false }, undefined)).toEqual({ show: true, saved: null });
  });

  it('takes the state from the card, and waits for it rather than guess', () => {
    expect(listingHeart(listing(), me, undefined)).toEqual({ show: false });
    expect(listingHeart(listing(), { signedIn: true, businessId: undefined }, true)).toEqual({ show: false });
    expect(listingHeart(listing(), me, true)).toEqual({ show: true, saved: true });
    // After a toggle the detail itself is patched too.
    expect(listingHeart(listing({ saved: false }), me, undefined)).toEqual({ show: true, saved: false });
  });
});
