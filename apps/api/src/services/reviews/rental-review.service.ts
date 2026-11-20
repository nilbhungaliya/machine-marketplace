import type { ReviewState } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { subjectReviewState } from './review-state.js';
import { submitSubjectReview } from './review.service.js';

// M14 lane A3 (plan A3-1, spec R11): reviews of a completed rental booking, F6's rules with the rental facets
// (`REVIEW_FACETS.rental[side]`: the renter rates matched / communication / on time, the owner communication / payment /
// care). Blind, 7 / 14 days from `completed_at`, one reply. Reply, report and hide use F6's routes by review id.

export interface RentalReviewInput {
  ratings: Record<string, unknown>;
  text?: string | null;
}

/**
 * `POST /rental-bookings/:id/review` inside the route's idempotent transaction. Not a party `404
 * RENTAL_BOOKING_NOT_FOUND`; viewer `403 VIEWER_READ_ONLY`; not completed `409 REVIEW_NOT_ELIGIBLE`; F6's window, once
 * per side and facet refusals.
 */
export function submitRentalReview(tx: Tx, user: UserTokenPayload, bookingId: string, input: RentalReviewInput): Promise<ReviewState> {
  return submitSubjectReview(tx, user, { kind: 'rental', id: bookingId }, input);
}

/** `GET /rental-bookings/:id/review` (party members, viewers too) and the Booking record's `review`. */
export function getRentalReviewState(conn: Db | Tx, user: UserTokenPayload, bookingId: string): Promise<ReviewState> {
  return subjectReviewState(conn, user, { kind: 'rental', id: bookingId });
}
