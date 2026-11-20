import { and, asc, eq, inArray, ne, or, type SQL } from 'drizzle-orm';
import { OPEN_RENTAL_STATUSES, type RentalSystemReason } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { listings, rentalBookings } from '../../db/schema.js';
import { lockListingsInOrder } from '../deals/locks.js';
import { writeBookingStatus, type BookingNotify } from './booking-write.js';
import { lockRentalBooking, type RentalBookingRow } from './locks.js';

/**
 * Rental system exits (M14 spec §6.1 "system" rows, §5.5a; plan C0-3a): open requests (`requested` / `countered`)
 * between businesses that can no longer deal end; agreed bookings (`confirmed` and later) are untouched (as F6's deals).
 * Each runs in its caller's transaction (suspension, GST revoke, block), **after the caller's own locks**, and takes
 * only booking → thread (bookings in id order): declining or withdrawing an open request changes no capacity.
 *
 * **Owner-side exits lock the owner's rental listings first** (C0 review I2): a request or confirm runs renter business
 * → listing `FOR UPDATE` → insert / update, so without the listing lock the exit's read of open bookings could miss a
 * request committing just after it. The caller takes them: the suspension folds `ownRentalListingIds` into its single
 * `lockListingsInOrder` pass (never a second, separately ordered pass, plan review #6); `revokeGst` (business row only)
 * calls `lockOwnRentalListings` after the business row. A request or confirm on those listings then either committed
 * first (its booking is seen and ended here) or waits and re-checks the owner's status / GST under its listing lock
 * (A1). Order stays business → listings (id order) → booking (`FOR NO KEY UPDATE`) → thread.
 */

/** The business's own `machine_rental` listing ids (every status but `draft`): the listings an owner-side exit locks. */
export async function ownRentalListingIds(tx: Tx, businessId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.businessId, businessId), eq(listings.kind, 'machine_rental'), ne(listings.status, 'draft')));
  return rows.map((r) => r.id);
}

/** Locks the business's own rental listings `FOR UPDATE` in id order (for a caller holding no listing lock yet). */
export async function lockOwnRentalListings(tx: Tx, businessId: string): Promise<void> {
  await lockListingsInOrder(tx, await ownRentalListingIds(tx, businessId));
}

const OPEN = [...OPEN_RENTAL_STATUSES];

interface Exit {
  action: 'system_decline' | 'system_withdraw';
  reason: RentalSystemReason;
  notify: BookingNotify[];
}

async function exitOpenBookings(tx: Tx, where: SQL, decide: (b: RentalBookingRow) => Exit): Promise<number> {
  const ids = (
    await tx
      .select({ id: rentalBookings.id })
      .from(rentalBookings)
      .where(and(inArray(rentalBookings.status, OPEN), where))
      .orderBy(asc(rentalBookings.id))
  ).map((r) => r.id);
  let n = 0;
  for (const id of ids) {
    const b = await lockRentalBooking(tx, id);
    // Re-checked under the lock: an answer that committed first wins.
    if (!b || (b.status !== 'requested' && b.status !== 'countered')) continue;
    const exit = decide(b);
    // The reason of a system decline or withdraw is stored in `decline_reason` (spec §5.1: "or a system exit's").
    await writeBookingStatus(tx, b, exit.action, { side: 'system' }, { declineReason: exit.reason }, { notify: exit.notify });
    n++;
  }
  return n;
}

/**
 * The business's **owner** user was suspended or blocked (wired next to `closeChainsForInactiveOwner`; the caller has
 * locked `ownRentalListingIds` in its listing pass): its open
 * requests as the owner → `declined` (`owner_inactive`, the renter told); as the renter → `withdrawn`
 * (`renter_inactive`, the owner told). Returns how many ended.
 */
export function exitBookingsForSuspendedBusiness(tx: Tx, businessId: string): Promise<number> {
  return exitOpenBookings(
    tx,
    or(eq(rentalBookings.ownerBusinessId, businessId), eq(rentalBookings.renterBusinessId, businessId))!,
    (b) =>
      b.ownerBusinessId === businessId
        ? { action: 'system_decline', reason: 'owner_inactive', notify: [{ to: 'renter', type: 'rental_booking_declined' }] }
        : { action: 'system_withdraw', reason: 'renter_inactive', notify: [{ to: 'owner', type: 'rental_booking_withdrawn' }] },
  );
}

/**
 * The business lost its GST verification (`revokeGst`, after `lockOwnRentalListings`): its open requests as the owner →
 * `declined` (`owner_gst`).
 */
export function exitBookingsForGstLoss(tx: Tx, businessId: string): Promise<number> {
  return exitOpenBookings(tx, eq(rentalBookings.ownerBusinessId, businessId), () => ({
    action: 'system_decline',
    reason: 'owner_gst',
    notify: [{ to: 'renter', type: 'rental_booking_declined' }],
  }));
}

/**
 * A block between two businesses (`blockFromThread`, either direction): open requests between them → `declined`
 * (`blocked`). No notification (a block is silent, as F6's closed chains); the thread shows the line.
 */
export function exitBookingsForBlock(tx: Tx, businessA: string, businessB: string): Promise<number> {
  return exitOpenBookings(
    tx,
    or(
      and(eq(rentalBookings.renterBusinessId, businessA), eq(rentalBookings.ownerBusinessId, businessB)),
      and(eq(rentalBookings.renterBusinessId, businessB), eq(rentalBookings.ownerBusinessId, businessA)),
    )!,
    () => ({ action: 'system_decline', reason: 'blocked', notify: [] }),
  );
}
