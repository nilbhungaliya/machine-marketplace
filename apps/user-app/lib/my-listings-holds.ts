import { milliToQuantity, quantityToMilli, type ListingStatus } from '@mpm/shared-types';
import { errorCode, errorDetails } from './api-error';
import type { ManageItem } from './my-listings';

// My listings with stock on hold in deals (F6 + F7 spec §8.3, §8.4, §15.2; plan L8-4). Pure. Quantities are decimal
// strings on the wire; sums are in thousandths (`quantityToMilli`), never floats.

const milli = (q: string | null | undefined): bigint | null => {
  if (q === null || q === undefined) return null;
  try {
    return quantityToMilli(q);
  } catch {
    return null;
  }
};

export interface HoldsView {
  /** On hold in open deals ("0" when none). */
  held: string;
  /** What buyers can still take. */
  available: string;
  /** Any stock on hold. */
  hasHolds: boolean;
  /** Everything is on hold (the listing shows "On hold in deals"). */
  allHeld: boolean;
}

/**
 * Held and available from a card (`quantity`, `availableQuantity = quantity − held`) or the owner view
 * (`heldQuantity`). Null when the listing has no quantity.
 */
export function holdsOf(l: { quantity: string | null; availableQuantity: string | null; heldQuantity?: string | null }): HoldsView | null {
  const total = milli(l.quantity);
  if (total === null) return null;
  let held = milli(l.heldQuantity ?? null);
  if (held === null) {
    const available = milli(l.availableQuantity);
    held = available === null ? 0n : total - available;
  }
  if (held < 0n) held = 0n;
  if (held > total) held = total;
  const available = total - held;
  return { held: milliToQuantity(held), available: milliToQuantity(available), hasHolds: held > 0n, allHeld: held > 0n && available === 0n };
}

/** A `reserved` listing, or one with stock on hold, shows the "On hold in deals" line with available / held. */
export function showHoldsLine(status: ListingStatus, holds: HoldsView | null): boolean {
  return !!holds && (holds.hasHolds || status === 'reserved');
}

/**
 * The manage sheet with stock on hold (§8.3): Mark sold and Remove would be refused (`409 LISTING_HAS_OPEN_DEALS`), so
 * they're left out while anything is held; Edit, Update quantity, Pause and the rest stay (`reserved` keeps Edit).
 */
export function holdsManageItems(items: readonly ManageItem[], holds: HoldsView | null): ManageItem[] {
  if (!holds?.hasHolds) return [...items];
  return items.filter((i) => i !== 'mark_sold' && i !== 'remove');
}

/** Update quantity's floor (§8.3): never below the stock on hold (`409 QUANTITY_BELOW_HELD`). */
export function quantityMinimum(holds: HoldsView | null): string | null {
  return holds?.hasHolds ? holds.held : null;
}

/** A new quantity below the stock on hold; false when it can't be read (the field's own check handles that). */
export function isBelowHeld(value: string, holds: HoldsView | null): boolean {
  if (!holds?.hasHolds) return false;
  const v = milli(value);
  const held = milli(holds.held);
  return v !== null && held !== null && v < held;
}

/** The open deals of a `409 LISTING_HAS_OPEN_DEALS` (`details.dealIds`); null for any other error. */
export function openDealIds(err: unknown): string[] | null {
  if (errorCode(err) !== 'LISTING_HAS_OPEN_DEALS') return null;
  const ids = errorDetails(err).dealIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
}

/** Pausing closes open offers and backups for good (§8.3, review change 21): a live or reserved listing confirms first. */
export function pauseNeedsWarning(status: ListingStatus): boolean {
  return status === 'live' || status === 'reserved';
}
