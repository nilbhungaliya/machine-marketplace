import { and, eq, sql } from 'drizzle-orm';
import { milliToQuantity, quantityToMilli, type ListingStatus } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { listings, stockHolds } from '../../db/schema.js';
import { ConflictError } from '../../lib/errors.js';
import { applySystemTransition, markSoldOnReturn, unmarkSoldOnReturn } from '../listings/listing-lifecycle.service.js';
import { lockListingOnly, type ListingRow } from '../listings/locks.js';
import { reconcileOffersForListing } from '../offers/reconcile.js';

/**
 * Stock holds and the listing's reserved state (F6 + F7 spec §8.1, §8.2, R16; plan C1-1).
 *
 * **This file is the only writer of `stock_holds`, of `listings.held_quantity` and of the completion decrement of
 * `listings.quantity`.** Available = `quantity − held_quantity` (one column read, §5.7). Every function runs in the
 * deal's (or listing write's) transaction and expects the caller to hold the listing lock already (§8.5: buyer business
 * → listing → deal → offers → thread); the re-locks below are no-ops then, and they lock **only the listing**, never the
 * seller business.
 *
 * Each hold change ends with `syncReservation`; the caller then runs `reconcileOffersForListing` (or
 * `afterListingStatusWrite`, which runs both) as §8.1's "Then" column says.
 */

/** Statuses a sell-out moves to `sold` (§8.2, `sell_out` in `LISTING_TRANSITIONS`). */
const SELL_OUT_FROM: readonly ListingStatus[] = ['live', 'reserved', 'paused', 'unavailable', 'expired'];
/** Statuses where a sell-out only sets `return_status = 'sold'` (§8.2). */
const SOLD_ON_RETURN: readonly ListingStatus[] = ['hidden', 'pending_review', 'rejected'];

/** `quantity − held_quantity` as a decimal string ("0" for a listing without a quantity). */
export function availableOf(listing: Pick<ListingRow, 'quantity' | 'heldQuantity'>): string {
  if (listing.quantity === null) return '0';
  const available = quantityToMilli(listing.quantity) - quantityToMilli(listing.heldQuantity);
  return milliToQuantity(available < 0n ? 0n : available);
}

/**
 * Puts the listing's status in line with its stock (§8.2), idempotent (a second call changes nothing):
 * - quantity 0 on `live`, `reserved`, `paused`, `unavailable`, `expired` → system `sell_out` → `sold`; on `hidden`,
 *   `pending_review`, `rejected` the status stays and `return_status = 'sold'`; `removed` (and every other status)
 *   stays as it is;
 * - `live` with nothing available → system `reserve`; `reserved` with something available → system `unreserve`;
 *   `pending_review` with stock again and `return_status = 'sold'` → `return_status = 'live'`.
 * Its moves go through `applySystemTransition(…, { lockBusiness: false })` directly and never call
 * `afterListingStatusWrite`, so nothing recurses. Returns the listing as it is now.
 */
export async function syncReservation(tx: Tx, listingId: string): Promise<ListingRow> {
  const listing = await lockListingOnly(tx, listingId);
  if (listing.status === 'removed' || listing.quantity === null) return listing;
  const quantity = quantityToMilli(listing.quantity);
  if (quantity === 0n) {
    if (SELL_OUT_FROM.includes(listing.status)) return applySystemTransition(tx, listing, 'sell_out', { lockBusiness: false });
    if (SOLD_ON_RETURN.includes(listing.status) && listing.returnStatus !== 'sold') return markSoldOnReturn(tx, listing);
    return listing;
  }
  // Stock back (a quantity edit while in review): approval lands live again, not sold.
  if (listing.status === 'pending_review' && listing.returnStatus === 'sold') return unmarkSoldOnReturn(tx, listing);
  const available = quantity - quantityToMilli(listing.heldQuantity);
  if (listing.status === 'live' && available <= 0n) return applySystemTransition(tx, listing, 'reserve', { lockBusiness: false });
  if (listing.status === 'reserved' && available > 0n) return applySystemTransition(tx, listing, 'unreserve', { lockBusiness: false });
  return listing;
}

/**
 * The hook every listing writer's **caller** runs after a status write or a stock-relevant edit (§8.3, §22; plan
 * review C1): `syncReservation`, then `reconcileOffersForListing`. Never called from inside `applySystemTransition`.
 * Returns the listing as it is after both.
 */
export async function afterListingStatusWrite(tx: Tx, listingId: string): Promise<ListingRow> {
  await syncReservation(tx, listingId);
  await reconcileOffersForListing(tx, listingId);
  return lockListingOnly(tx, listingId);
}

function notAvailable(available: string): ConflictError {
  return new ConflictError('That much is no longer available', 'QUANTITY_NOT_AVAILABLE', { available });
}

/**
 * Accept (§8.1): an `active` hold of `quantity` for the deal (inserted first, textile D3) and `held_quantity +=
 * quantity`, then `syncReservation`. More than is available → `409 QUANTITY_NOT_AVAILABLE` (`details.available`) and
 * nothing written; the check is in the `UPDATE` itself, so a stale `listing` can't over-hold.
 */
export async function placeHold(tx: Tx, listing: ListingRow, dealId: string, quantity: string): Promise<void> {
  const milli = quantityToMilli(quantity);
  if (milli <= 0n) throw new Error('placeHold: quantity must be positive');
  const q = milliToQuantity(milli);
  const [updated] = await tx
    .update(listings)
    .set({ heldQuantity: sql`${listings.heldQuantity} + ${q}::numeric` })
    .where(
      and(
        eq(listings.id, listing.id),
        sql`${listings.quantity} IS NOT NULL`,
        sql`${listings.quantity} - ${listings.heldQuantity} >= ${q}::numeric`,
      ),
    )
    .returning({ id: listings.id });
  if (!updated) {
    const current = await lockListingOnly(tx, listing.id);
    throw notAvailable(availableOf(current));
  }
  await tx.insert(stockHolds).values({ listingId: listing.id, dealId, quantity: q, status: 'active' });
  await syncReservation(tx, listing.id);
}

/** The deal's active hold, locked; null when it has none (already settled or never placed). */
async function activeHold(tx: Tx, dealId: string): Promise<typeof stockHolds.$inferSelect | null> {
  const [hold] = await tx
    .select()
    .from(stockHolds)
    .where(and(eq(stockHolds.dealId, dealId), eq(stockHolds.status, 'active')))
    .for('update');
  return hold ?? null;
}

/**
 * A deal cancelled, any way (§8.1): its hold → `released`, `held_quantity −= quantity`, then `syncReservation` (may
 * unreserve). No-op when the deal has no active hold.
 */
export async function releaseHold(tx: Tx, dealId: string): Promise<void> {
  const hold = await activeHold(tx, dealId);
  if (!hold) return;
  await tx.update(stockHolds).set({ status: 'released', settledAt: sql`now()` }).where(eq(stockHolds.id, hold.id));
  await tx
    .update(listings)
    .set({ heldQuantity: sql`${listings.heldQuantity} - ${hold.quantity}::numeric` })
    .where(eq(listings.id, hold.listingId));
  await syncReservation(tx, hold.listingId);
}

/**
 * A deal completed, any way, or a dispute closed as cancelled with the goods not back (§8.1, §9.6): its hold →
 * `converted`, `quantity −= held`, `held_quantity −= held`, `min_order_qty` lowered to the new quantity when above it
 * (null at 0, keeping F2's positive CHECK), then `syncReservation` (quantity 0 → sell-out). No-op when the deal has no
 * active hold.
 */
export async function convertHold(tx: Tx, dealId: string): Promise<void> {
  const hold = await activeHold(tx, dealId);
  if (!hold) return;
  await tx.update(stockHolds).set({ status: 'converted', settledAt: sql`now()` }).where(eq(stockHolds.id, hold.id));
  const q = sql`${hold.quantity}::numeric`;
  const left = sql`(${listings.quantity} - ${q})`;
  await tx
    .update(listings)
    .set({
      quantity: left,
      heldQuantity: sql`${listings.heldQuantity} - ${q}`,
      minOrderQty: sql`CASE WHEN ${left} = 0 THEN NULL WHEN ${listings.minOrderQty} > ${left} THEN ${left} ELSE ${listings.minOrderQty} END`,
      updatedAt: sql`now()`,
    })
    .where(eq(listings.id, hold.listingId));
  await syncReservation(tx, hold.listingId);
}
