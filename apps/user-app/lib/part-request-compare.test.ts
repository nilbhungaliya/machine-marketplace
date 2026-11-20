import { describe, expect, it } from 'vitest';
import type { CompareColumn } from '@mpm/shared-types';
import { compareRows, lowestPriceColumns } from './part-request-compare';

const col = (over: Partial<CompareColumn> = {}): CompareColumn => ({
  listingId: 'l1',
  source: 'reply',
  title: 'Tie rod end',
  pricePerUnitPaise: 115_000,
  priceOnRequest: false,
  availableQuantity: '10',
  unitLabel: 'pcs',
  side: 'right',
  conditionLabel: 'New',
  distanceKm: 6,
  rating: 4.8,
  reviewCount: 12,
  verified: true,
  lowestPrice: false,
  contactAction: 'offer',
  ...over,
});

describe('compareRows (§13.1)', () => {
  it('orders the rows price, available, side, condition, distance, rating, verified', () => {
    expect(compareRows([col()]).map((r) => r.key)).toEqual(['price', 'available', 'side', 'condition', 'distance', 'rating', 'verified']);
  });

  it('flags the lowest price only among priced columns', () => {
    const cols = [
      col({ listingId: 'a', pricePerUnitPaise: 115_000 }),
      col({ listingId: 'b', pricePerUnitPaise: null, priceOnRequest: true }),
      col({ listingId: 'c', pricePerUnitPaise: 98_000 }),
      col({ listingId: 'd', pricePerUnitPaise: 124_000 }),
    ];
    const price = compareRows(cols)[0]!;
    expect(price.cells.map((c) => c.row === 'price' && c.lowest)).toEqual([false, false, true, false]);
    expect(price.cells[1]).toEqual({ row: 'price', paise: null, onRequest: true, lowest: false });
  });

  it('marks nothing with fewer than two prices, and every tie', () => {
    expect(lowestPriceColumns([col(), col({ priceOnRequest: true, pricePerUnitPaise: null })]).size).toBe(0);
    expect([...lowestPriceColumns([col({ pricePerUnitPaise: 5 }), col({ pricePerUnitPaise: 5 }), col({ pricePerUnitPaise: 9 })])]).toEqual([0, 1]);
  });

  it('leaves out the side row when no column has a side', () => {
    expect(compareRows([col({ side: null }), col({ side: null })]).map((r) => r.key)).not.toContain('side');
  });
});
