import { eq } from 'drizzle-orm';
import type { DealStatus, RentalBookingStatus, ReviewSubjectKind } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { deals, rentalBookings } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { lockDeal } from '../deals/locks.js';
import { lockRentalBooking } from '../rentals/locks.js';

/**
 * What a review or a dispute is about (M14 spec §5.5a, R11, R12; plan C0-3a): an F6 deal or an M14 rental booking,
 * exactly one per row (`deal_reviews_subject_one`, `deal_disputes_subject_one`). Every reader that assumed `deal_id`
 * goes through these helpers (A3 generalises them): the subject's title, display ref, parties, thread, status and
 * completion, its lock and its notification destination. For a booking the renter is the buyer and the owner the seller.
 */

export interface ReviewSubjectRef {
  kind: ReviewSubjectKind;
  id: string;
}

export interface LoadedSubject {
  ref: ReviewSubjectRef;
  /** The listing title snapshot (unmasked: mask on the way out). */
  title: string;
  /** `#500001…` for a deal, `#700001…` for a booking. */
  displayRef: number;
  buyerBusinessId: string;
  sellerBusinessId: string;
  threadId: string;
  status: DealStatus | RentalBookingStatus;
  completedAt: Date | null;
}

/** The subject of a review / dispute row. Throws when the row has neither (the CHECK makes that impossible). */
export function subjectOf(row: { dealId: string | null; rentalBookingId: string | null }): ReviewSubjectRef {
  if (row.dealId) return { kind: 'deal', id: row.dealId };
  if (row.rentalBookingId) return { kind: 'rental', id: row.rentalBookingId };
  throw new Error('subjectOf: a review / dispute row without a subject');
}

/** The subject's facts, or null when it doesn't exist. */
export async function loadSubject(conn: Db | Tx, ref: ReviewSubjectRef): Promise<LoadedSubject | null> {
  if (ref.kind === 'deal') {
    const [d] = await conn
      .select({
        title: deals.listingTitle,
        displayRef: deals.ref,
        buyerBusinessId: deals.buyerBusinessId,
        sellerBusinessId: deals.sellerBusinessId,
        threadId: deals.threadId,
        status: deals.status,
        completedAt: deals.completedAt,
      })
      .from(deals)
      .where(eq(deals.id, ref.id));
    return d ? { ref, ...d } : null;
  }
  const [b] = await conn
    .select({
      title: rentalBookings.listingTitle,
      displayRef: rentalBookings.ref,
      buyerBusinessId: rentalBookings.renterBusinessId,
      sellerBusinessId: rentalBookings.ownerBusinessId,
      threadId: rentalBookings.threadId,
      status: rentalBookings.status,
      completedAt: rentalBookings.completedAt,
    })
    .from(rentalBookings)
    .where(eq(rentalBookings.id, ref.id));
  return b ? { ref, ...b } : null;
}

/**
 * Locks the subject (`lockDeal` / `lockRentalBooking`, both `FOR NO KEY UPDATE`: review and dispute rows take `KEY
 * SHARE` on it) and returns its facts. `404 DEAL_NOT_FOUND` / `404 RENTAL_BOOKING_NOT_FOUND` when it doesn't exist.
 */
export async function lockSubject(tx: Tx, ref: ReviewSubjectRef): Promise<LoadedSubject> {
  if (ref.kind === 'deal') await lockDeal(tx, ref.id);
  else if (!(await lockRentalBooking(tx, ref.id))) throw new AppError('Booking not found', 404, 'RENTAL_BOOKING_NOT_FOUND');
  return (await loadSubject(tx, ref))!;
}

/** The notification destination of the subject (`notify(tx, { destination })`). */
export function subjectDestination(ref: ReviewSubjectRef): { dealId: string } | { rentalBookingId: string } {
  return ref.kind === 'deal' ? { dealId: ref.id } : { rentalBookingId: ref.id };
}
