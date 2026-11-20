import { asc, sql } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { rentalBookings } from '../../db/schema.js';
import { IST_TODAY } from '../../lib/ist.js';
import { notifyBooking } from './booking-write.js';
import { clashWithFor } from './capacity.js';

/**
 * The overrun clash notice (M14 spec §6.4, plan A2-3, D13). For each booking of the listing still out past its end date
 * (`on_rent`, or disputed from `on_rent`), `clashWithFor` finds the confirmed booking starting today or tomorrow that it
 * pushes over the listing's quantity; the owner gets `rental_booking_clash` on the overrunning booking (the one to mark
 * returned), deduped per (owner user, overrunning booking, colliding booking) with `clash:<a>:<b>`, so a job re-run or a
 * later day tells nobody twice. Never cancels anything. Run with the listing locked (the status-sync job). Returns the
 * clashes found (told now or before).
 */
export async function detectClashes(tx: Tx, listingId: string): Promise<number> {
  const overrunning = await tx
    .select()
    .from(rentalBookings)
    .where(
      sql`${rentalBookings.listingId} = ${listingId}::uuid
        AND (${rentalBookings.status} = 'on_rent' OR (${rentalBookings.status} = 'disputed' AND ${rentalBookings.disputedFrom} = 'on_rent'))
        AND ${rentalBookings.endDate} < ${IST_TODAY}`,
    )
    .orderBy(asc(rentalBookings.ref));
  let found = 0;
  for (const b of overrunning) {
    const clash = await clashWithFor(tx, b.id);
    if (!clash) continue;
    found++;
    await notifyBooking(tx, b, { to: 'owner', type: 'rental_booking_clash', dedupeKey: `clash:${b.id}:${clash.id}` });
  }
  return found;
}

/** Listings with a booking still out past its end date (the clash job's candidates besides status mismatches). */
export const overrunListingIdsSql = sql`
  SELECT DISTINCT o.listing_id FROM rental_bookings o
  WHERE (o.status = 'on_rent' OR (o.status = 'disputed' AND o.disputed_from = 'on_rent')) AND o.end_date < ${IST_TODAY}`;
