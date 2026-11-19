import { describe, expect, it } from 'vitest';
import { LISTING_CARD_TAGS } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import { resources } from '@/locales';
import { cardTagKeys, sideTagKey } from './side-tags';

describe('card tag copy (spec §4.7, R6, R7)', () => {
  it('maps each tag to its copy key', () => {
    expect(sideTagKey('reserved')).toBe('discover.tags.reserved');
    expect(sideTagKey('on_rent')).toBe('discover.tags.on_rent');
    expect(sideTagKey('pair_contains_left')).toBe('discover.tags.pair_contains_left');
    expect(sideTagKey('pair_contains_right')).toBe('discover.tags.pair_contains_right');
  });

  it('the English copy', () => {
    expect(i18n.t(sideTagKey('reserved'))).toBe('Reserved');
    expect(i18n.t(sideTagKey('on_rent'))).toBe('On rent');
    expect(i18n.t(sideTagKey('pair_contains_left'))).toBe('Pair: contains a left');
    expect(i18n.t(sideTagKey('pair_contains_right'))).toBe('Pair: contains a right');
  });

  it('every tag has copy in en, hi and gu', () => {
    for (const lang of ['en', 'hi', 'gu'] as const) {
      const tags = (resources[lang].translation.discover as unknown as { tags: Record<string, string> }).tags;
      for (const tag of LISTING_CARD_TAGS) expect(tags[tag], `${lang}: ${tag}`).toBeTruthy();
    }
  });

  it('unknown tags (a newer API) are skipped, known ones kept in order', () => {
    expect(cardTagKeys(['on_rent', 'something_new' as never, 'reserved'])).toEqual(['discover.tags.on_rent', 'discover.tags.reserved']);
    expect(cardTagKeys(undefined)).toEqual([]);
  });
});
