import type { ReviewState } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import type { TxApp } from '../../lib/tx-effects.js';
import type { UserTokenPayload } from '../../plugins/auth.js';

// M14 lane A3 (plan A3-1, spec R11): reviews of a completed rental booking, F6's rules with the rental facets
// (`REVIEW_FACETS.rental[side]`, the owner rates `care`). Reply, report and hide use F6's routes by review id.

export interface RentalReviewInput {
  ratings: Record<string, unknown>;
  text?: string | null;
}

/** `POST /rental-bookings/:id/review`. */
export async function submitRentalReview(
  _app: TxApp,
  _user: UserTokenPayload,
  _bookingId: string,
  _input: RentalReviewInput,
): Promise<ReviewState | null> {
  // M14-STUB(A3)
  return null;
}

/** `GET /rental-bookings/:id/review`. */
export async function getRentalReviewState(_conn: Db | Tx, _user: UserTokenPayload, _bookingId: string): Promise<ReviewState | null> {
  // M14-STUB(A3)
  return null;
}
