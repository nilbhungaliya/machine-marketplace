import type { RentalDisputeCategory } from '@mpm/shared-types';
import type { TxApp } from '../../lib/tx-effects.js';
import type { UserTokenPayload } from '../../plugins/auth.js';

// M14 lane A3 (plan A3-2, spec R12): a party reports a problem on an `on_rent` / `returned` booking → `disputed` plus a
// dispute row (subject `rental`). A1's `POST /rental-bookings/:id/problem` route finalises the photos (destination
// `{ kind: 'rental', step: 'problem' }`) before calling it, then rereads the booking with its own view.

export interface ReportBookingProblemInput {
  category: RentalDisputeCategory;
  description: string;
  /** Final private keys (`rental/<bookingId>/…`), finalised by the route. */
  photoKeys: string[];
}

export async function reportBookingProblem(
  _app: TxApp,
  _user: UserTokenPayload,
  bookingId: string,
  _input: ReportBookingProblemInput,
): Promise<{ bookingId: string }> {
  // M14-STUB(A3)
  return { bookingId };
}
