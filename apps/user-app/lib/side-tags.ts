import { LISTING_CARD_TAGS, type ListingCardTag } from '@mpm/shared-types';

// Card tags (F4 + F5 spec §4.7, R6, R7): Reserved, On rent, and a Pair shown under a Left / Right side filter
// ("Pair: contains a left"). Copy in `discover.json` under `tags`.

export function sideTagKey(tag: ListingCardTag): string {
  return `discover.tags.${tag}`;
}

/** The copy keys of a card's tags, in the API's order; a tag this build doesn't know is skipped. */
export function cardTagKeys(tags: readonly ListingCardTag[] | null | undefined): string[] {
  return (tags ?? []).filter((t) => (LISTING_CARD_TAGS as readonly string[]).includes(t)).map(sideTagKey);
}
