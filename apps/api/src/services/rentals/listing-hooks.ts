import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { ACTIVE_RENTAL_STATUSES, OPEN_RENTAL_STATUSES, type RentalBookingStatus } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { rentalBookings } from '../../db/schema.js';
import { ConflictError } from '../../lib/errors.js';
import { IST_TODAY } from '../../lib/ist.js';
import { writeBookingStatus } from './booking-write.js';
import { capacityIntervalsSql, maxOutInRange } from './capacity.js';
import { lockRentalBooking } from './locks.js';

/**
 * Listing writes that meet bookings (M14 spec §7.2, the listing-state table; plan C0-3b). Every function runs in the
 * listing writer's transaction, **with the listing already locked** (the seller's business → listing, or the admin's).
 * Wiring: `applySellerAction` (remove / mark unavailable: `assertNoActiveBookings`), `writeStatus` (a rental going
 * `removed` / `rejected` / `unavailable`: `cancelBookingsForListingOff`), `patchListing` (a quantity decrease:
 * `assertQuantityCoversBookings`), the expiry job (skips rentals with an active booking). Hide, pause and expire never
 * cancel anything.
 */

const ACTIVE = [...ACTIVE_RENTAL_STATUSES];

/** `409 LISTING_HAS_OPEN_BOOKINGS` (`details.bookingIds`) while a `confirmed` / `on_rent` / `returned` / `disputed` booking exists. */
export async function assertNoActiveBookings(tx: Tx, listingId: string): Promise<void> {
  const rows = await tx
    .select({ id: rentalBookings.id })
    .from(rentalBookings)
    .where(and(eq(rentalBookings.listingId, listingId), inArray(rentalBookings.status, ACTIVE)))
    .orderBy(asc(rentalBookings.startDate), asc(rentalBookings.id));
  if (rows.length > 0) {
    throw new ConflictError('Finish or cancel the bookings on this machine first', 'LISTING_HAS_OPEN_BOOKINGS', {
      bookingIds: rows.map((r) => r.id),
    });
  }
}

/**
 * `409 RENTAL_QUANTITY_BOOKED` (`details.booked`: the most machines out on a day) when some day from today (IST) on
 * would have more machines out than `newQuantity`.
 */
export async function assertQuantityCoversBookings(tx: Tx, listingId: string, newQuantity: number): Promise<void> {
  const { rows } = await tx.execute<{ today: string; last: string }>(sql`
    SELECT ${IST_TODAY}::text AS today, GREATEST(max(i.e), ${IST_TODAY})::text AS last FROM ${capacityIntervalsSql(listingId)} i
  `);
  const { today, last } = rows[0]!;
  const booked = await maxOutInRange(tx, listingId, today, last);
  if (booked > newQuantity) {
    throw new ConflictError('More machines than that are booked on some days', 'RENTAL_QUANTITY_BOOKED', { booked });
  }
}

/**
 * The listing went off the market for good (§7.2): its open requests (`scope: 'open'`, a seller's remove or mark
 * unavailable, which `assertNoActiveBookings` already cleared of active bookings) or its open requests and `confirmed`
 * bookings (`'open_and_confirmed'`: an admin remove, reject, ask for changes, photos removed) → `cancelled`
 * (`listing_removed`, both sides told). `on_rent` / `returned` / `disputed` continue to their end. Bookings in id
 * order, each locked booking → thread (the listing is the caller's). Returns how many were cancelled.
 */
export async function cancelBookingsForListingOff(
  tx: Tx,
  listingId: string,
  scope: 'open' | 'open_and_confirmed',
  reason: 'listing_removed' = 'listing_removed',
): Promise<number> {
  const statuses: RentalBookingStatus[] = scope === 'open' ? [...OPEN_RENTAL_STATUSES] : [...OPEN_RENTAL_STATUSES, 'confirmed'];
  const ids = (
    await tx
      .select({ id: rentalBookings.id })
      .from(rentalBookings)
      .where(and(eq(rentalBookings.listingId, listingId), inArray(rentalBookings.status, statuses)))
      .orderBy(asc(rentalBookings.id))
  ).map((r) => r.id);
  let n = 0;
  for (const id of ids) {
    const b = await lockRentalBooking(tx, id);
    if (!b || !statuses.includes(b.status)) continue;
    await writeBookingStatus(tx, b, 'system_cancel', { side: 'system' }, { cancelReason: reason }, {
      notify: [{ to: 'both', type: 'rental_booking_cancelled' }],
    });
    n++;
  }
  return n;
}
