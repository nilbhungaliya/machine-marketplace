import type { Db, Tx } from '../../db/index.js';

// M14 lane A1 (plan A1-4): the booking reads (list, detail, views) and the Deals tab badge count live here.

/**
 * `Badges.rentalsYourTurn` (§6.6): the business's bookings whose next step is its own (`rentalYourTurn` with today's
 * IST date), as renter and as owner.
 */
export async function countRentalsYourTurn(_conn: Db | Tx, _businessId: string): Promise<number> {
  // M14-STUB(A1)
  return 0;
}
