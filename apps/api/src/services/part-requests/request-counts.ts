import type { Db, Tx } from '../../db/index.js';
import type { UserTokenPayload } from '../../plugins/auth.js';

// Counts for badges (spec §12.4). Lane A1 owns this file.

/** "Requests for you": active requests the user's business is targeted by and hasn't opened or answered. */
export async function requestsForYouCount(_conn: Db | Tx, _user: UserTokenPayload): Promise<number> {
  // F8-STUB(A1): count from part_request_targets.
  return 0;
}
