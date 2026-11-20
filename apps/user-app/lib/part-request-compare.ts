import type { CompareColumn, PartSide } from '@mpm/shared-types';

// Compare replies and matches (F8 spec §13.1, R10; mockup "Compare replies"; textile's compare table): the rows in a
// fixed order, one cell per column, the lowest price marked. Pure: the screen turns cells into text.

export const COMPARE_ROW_ORDER = ['price', 'available', 'side', 'condition', 'distance', 'rating', 'verified'] as const;
export type CompareRowKey = (typeof COMPARE_ROW_ORDER)[number];

export type CompareCell =
  | { row: 'price'; paise: number | null; onRequest: boolean; lowest: boolean }
  | { row: 'available'; quantity: string | null; unitLabel: string | null }
  | { row: 'side'; side: PartSide | null }
  | { row: 'condition'; label: string | null }
  | { row: 'distance'; km: number | null }
  | { row: 'rating'; stars: number | null; reviews: number }
  | { row: 'verified'; verified: boolean };

export interface CompareRow {
  key: CompareRowKey;
  cells: CompareCell[];
}

const priced = (c: CompareColumn): c is CompareColumn & { pricePerUnitPaise: number } => !c.priceOnRequest && c.pricePerUnitPaise !== null;

/**
 * The columns holding the lowest price: only among priced columns (not "price on request"), and only when at least two
 * are priced (one price is not "the lowest"). Ties are all marked.
 */
export function lowestPriceColumns(columns: readonly CompareColumn[]): Set<number> {
  const prices = columns.filter(priced).map((c) => c.pricePerUnitPaise);
  if (prices.length < 2) return new Set();
  const min = Math.min(...prices);
  return new Set(columns.flatMap((c, i) => (priced(c) && c.pricePerUnitPaise === min ? [i] : [])));
}

/**
 * The table's rows (price, available, side, condition, distance, rating, verified), each with one cell per column. The
 * side row is left out when no column has a side (machines).
 */
export function compareRows(columns: readonly CompareColumn[]): CompareRow[] {
  const lowest = lowestPriceColumns(columns);
  const rows: CompareRow[] = COMPARE_ROW_ORDER.map((key) => ({
    key,
    cells: columns.map((c, i): CompareCell => {
      switch (key) {
        case 'price':
          return { row: 'price', paise: c.priceOnRequest ? null : c.pricePerUnitPaise, onRequest: c.priceOnRequest, lowest: lowest.has(i) };
        case 'available':
          return { row: 'available', quantity: c.availableQuantity, unitLabel: c.unitLabel };
        case 'side':
          return { row: 'side', side: c.side };
        case 'condition':
          return { row: 'condition', label: c.conditionLabel };
        case 'distance':
          return { row: 'distance', km: c.distanceKm };
        case 'rating':
          return { row: 'rating', stars: c.rating, reviews: c.reviewCount };
        case 'verified':
          return { row: 'verified', verified: c.verified };
      }
    }),
  }));
  const anySide = columns.some((c) => c.side !== null && c.side !== 'not_applicable');
  return anySide ? rows : rows.filter((r) => r.key !== 'side');
}
