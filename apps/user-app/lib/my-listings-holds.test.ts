import { describe, expect, it } from 'vitest';
import { manageItems } from './my-listings';
import { holdsManageItems, holdsOf, isBelowHeld, openDealIds, quantityMinimum, showHoldsLine } from './my-listings-holds';

describe('holdsOf (§8.4)', () => {
  it('derives held from quantity minus available, in thousandths', () => {
    expect(holdsOf({ quantity: '3', availableQuantity: '1' })).toEqual({ held: '2', available: '1', hasHolds: true, allHeld: false });
    expect(holdsOf({ quantity: '2.5', availableQuantity: '0.75' })).toEqual({ held: '1.75', available: '0.75', hasHolds: true, allHeld: false });
    expect(holdsOf({ quantity: '4', availableQuantity: '0' })).toMatchObject({ held: '4', available: '0', allHeld: true });
  });

  it("prefers the owner view's heldQuantity", () => {
    expect(holdsOf({ quantity: '5', availableQuantity: null, heldQuantity: '2' })).toMatchObject({ held: '2', available: '3' });
  });

  it('no quantity is null; nothing held shows no line on a live listing', () => {
    expect(holdsOf({ quantity: null, availableQuantity: null })).toBeNull();
    const none = holdsOf({ quantity: '3', availableQuantity: '3' });
    expect(none).toMatchObject({ held: '0', hasHolds: false });
    expect(showHoldsLine('live', none)).toBe(false);
    expect(showHoldsLine('reserved', holdsOf({ quantity: '3', availableQuantity: '0' }))).toBe(true);
  });
});

describe('the quantity sheet floor (§8.3)', () => {
  const holds = holdsOf({ quantity: '5', availableQuantity: '3' });

  it('is the held quantity', () => {
    expect(quantityMinimum(holds)).toBe('2');
    expect(isBelowHeld('1.999', holds)).toBe(true);
    expect(isBelowHeld('2', holds)).toBe(false);
    expect(isBelowHeld('10', holds)).toBe(false);
  });

  it('has no floor without holds', () => {
    const none = holdsOf({ quantity: '5', availableQuantity: '5' });
    expect(quantityMinimum(none)).toBeNull();
    expect(isBelowHeld('1', none)).toBe(false);
  });
});

describe('the manage sheet with holds (§8.3)', () => {
  it('a reserved listing keeps Edit and Pause, without Mark sold or Remove', () => {
    const reserved = { status: 'reserved' as const, kind: 'part' as const, side: null };
    const holds = holdsOf({ quantity: '2', availableQuantity: '0' });
    const items = holdsManageItems(manageItems(reserved, { view: true }), holds);
    expect(items).toContain('edit');
    expect(items).toContain('quantity');
    expect(items).toContain('pause');
    expect(items).not.toContain('mark_sold');
    expect(items).not.toContain('remove');
  });

  it('a live listing with part on hold loses Mark sold and Remove; without holds keeps them', () => {
    const live = { status: 'live' as const, kind: 'part' as const, side: null };
    expect(holdsManageItems(manageItems(live), holdsOf({ quantity: '3', availableQuantity: '1' }))).not.toContain('mark_sold');
    const free = holdsManageItems(manageItems(live), holdsOf({ quantity: '3', availableQuantity: '3' }));
    expect(free).toContain('mark_sold');
    expect(free).toContain('remove');
  });
});

describe('openDealIds', () => {
  const err = (code: string, details?: object) => ({ response: { status: 409, data: { code, details } } });

  it('reads details.dealIds of LISTING_HAS_OPEN_DEALS only', () => {
    expect(openDealIds(err('LISTING_HAS_OPEN_DEALS', { dealIds: ['d1', 2, 'd2'] }))).toEqual(['d1', 'd2']);
    expect(openDealIds(err('LISTING_HAS_OPEN_DEALS'))).toEqual([]);
    expect(openDealIds(err('QUANTITY_BELOW_HELD'))).toBeNull();
  });
});
