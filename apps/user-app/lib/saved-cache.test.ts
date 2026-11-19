import { describe, expect, it } from 'vitest';
import type { InfiniteData } from '@tanstack/react-query';
import type { HomeView, ListingCard, SavedListingsPage, SearchPage } from '@mpm/shared-types';
import { canShowHeart, patchSaved } from './saved-cache';

const card = (id: string, saved: boolean | null = false): ListingCard => ({
  id, ref: 100000 + Number(id.slice(-1)), kind: 'part', status: 'live', title: `Part ${id}`, side: null, condition: null,
  quantity: '1', unit: null, priceModel: 'fixed', pricePaise: 1000, gstMode: null, rate: null, thumbUrl: null, city: null,
  industrialAreaName: null, distanceKm: null, refreshedAt: null, businessId: 'biz', saved, tags: [],
});

describe('save toggle cache patch (spec §8.4: a toggle patches every cached card)', () => {
  it('patches a card list and keeps untouched cards by reference', () => {
    const list = [card('l1'), card('l2')];
    const out = patchSaved(list, 'l2', true);
    expect(out[1].saved).toBe(true);
    expect(out[0]).toBe(list[0]);
    expect(list[1].saved).toBe(false);
  });

  it('patches infinite search pages', () => {
    const page = (items: ListingCard[]): SearchPage => ({
      items, nextCursor: null, total: items.length, sort: 'newest', partial: false, widen: null, refSuggestion: null,
      facets: null, origin: { label: null, source: null },
      reading: { ref: null, brand: null, model: null, category: null, partNumbers: [], side: null, words: [], wordGroups: [] },
    });
    const data: InfiniteData<SearchPage, string | null> = { pages: [page([card('l1')]), page([card('l2'), card('l3')])], pageParams: [null, 'c'] };
    const out = patchSaved(data, 'l3', true);
    expect(out.pages[1].items[1].saved).toBe(true);
    expect(out.pages[0]).toBe(data.pages[0]);
    expect(out.pageParams).toBe(data.pageParams);
  });

  it('patches the home view and the saved list', () => {
    const home: HomeView = {
      origin: { label: 'Aji GIDC, Rajkot', source: 'gps' }, radiusKm: 50, kindTiles: [], rootCategories: [],
      topNearYou: [card('l1')], rentNearby: [card('l1')],
    };
    const out = patchSaved(home, 'l1', true);
    expect(out.topNearYou[0].saved).toBe(true);
    expect(out.rentNearby[0].saved).toBe(true);

    const savedPage: SavedListingsPage = {
      items: [{ listingId: 'l1', savedAt: '2026-11-19', card: card('l1', true) }, { listingId: 'l2', savedAt: '2026-11-19', unavailable: true }],
      nextCursor: null,
    };
    const unsaved = patchSaved(savedPage, 'l1', false);
    expect((unsaved.items[0] as { card: ListingCard }).card.saved).toBe(false);
    expect(unsaved.items[1]).toBe(savedPage.items[1]);
  });

  it('returns the same reference when nothing matches (no re-render)', () => {
    const list = [card('l1')];
    expect(patchSaved(list, 'zz', true)).toBe(list);
    expect(patchSaved(undefined, 'l1', true)).toBeUndefined();
    expect(patchSaved(null, 'l1', true)).toBeNull();
    const already = [card('l1', true)];
    expect(patchSaved(already, 'l1', true)).toBe(already);
  });

  it("the heart shows for guests and other businesses' listings, never on your own", () => {
    expect(canShowHeart(card('l1'), { signedIn: false })).toBe(true);
    expect(canShowHeart(card('l1'), { signedIn: true, businessId: 'other' })).toBe(true);
    expect(canShowHeart(card('l1'), { signedIn: true, businessId: 'biz' })).toBe(false);
    expect(canShowHeart(card('l1'), { signedIn: true, businessId: null })).toBe(true);
  });

  it('hides the heart for a signed-in viewer until the business is known', () => {
    expect(canShowHeart(card('l1'), { signedIn: true, businessId: undefined })).toBe(false);
  });
});
