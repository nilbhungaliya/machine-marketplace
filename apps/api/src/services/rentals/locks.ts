import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { listings, rentalBookings } from '../../db/schema.js';
import { lockBuyerBusiness } from '../deals/locks.js';
import { listingNotFound, type BusinessRow, type ListingRow } from '../listings/locks.js';

/**
 * Row locks for M14 rental bookings (spec §6.7), in **this order** whenever a transaction takes more than one:
 *
 *   renter business (`FOR NO KEY UPDATE`, only on request, where limits are counted) → **listing (`FOR UPDATE`)** →
 *   booking (`FOR NO KEY UPDATE`) → thread (`FOR UPDATE`, taken by the line / card writers)
 *
 * **Every capacity writer locks the listing first** (request, change, confirm, accept, on site, return, cancel,
 * resolve, blocks, quantity edits, `syncRentalStatus`), so `assertCapacity` can't race (review focus #1). Bookings are
 * never locked `FOR UPDATE` (rows referencing a booking — events, versions, messages, notifications, reviews — take
 * `KEY SHARE` on it, which `FOR NO KEY UPDATE` doesn't block). The seller's listing PATCH and block writes already take
 * business → listing (`lockBusinessThenListing`); a booking write that needs the owner business doesn't lock it.
 * System exits (suspension, GST revoke, block) change no capacity: they take booking → thread, after their own locks;
 * the owner-side ones (suspension, GST revoke) first lock the owner's rental listings in id order (in the suspension's
 * single listing pass; after the business row in `revokeGst`), so a concurrent request / confirm is serialised.
 */

export type RentalBookingRow = typeof rentalBookings.$inferSelect;

/** The rental listing (`FOR UPDATE`); `404 LISTING_NOT_FOUND` when it doesn't exist or isn't a `machine_rental`. */
export async function lockListingForRental(tx: Tx, listingId: string): Promise<ListingRow> {
  const [row] = await tx
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.kind, 'machine_rental')))
    .for('update');
  if (!row) throw listingNotFound();
  return row;
}

/** The renter's business (`FOR NO KEY UPDATE`): serialises one business's requests and their limits. First in §6.7. */
export function lockRenterBusiness(tx: Tx, businessId: string): Promise<BusinessRow> {
  return lockBuyerBusiness(tx, businessId);
}

/**
 * The booking, `FOR NO KEY UPDATE` (`SKIP LOCKED` for jobs: null when another transaction holds it); null when it
 * doesn't exist (party checks and `404 RENTAL_BOOKING_NOT_FOUND` are the caller's). Take the listing lock first when the
 * write changes capacity.
 */
export async function lockRentalBooking(
  tx: Tx,
  id: string,
  opts: { skipLocked?: boolean } = {},
): Promise<RentalBookingRow | null> {
  const [row] = await tx
    .select()
    .from(rentalBookings)
    .where(eq(rentalBookings.id, id))
    .for('no key update', opts.skipLocked ? { skipLocked: true } : undefined);
  return row ?? null;
}
