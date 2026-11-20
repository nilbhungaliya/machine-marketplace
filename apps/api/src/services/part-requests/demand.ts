import type { Db, Tx } from '../../db/index.js';

// "Buyers are looking for this" on the seller's listing (spec §12.3, `GET /listings/:id/part-request-demand`). Lane A2.

/** Ids of active requests the seller is eligible for that the listing could answer (at most `demandIdsMax`). */
export async function demandRequestIds(_conn: Db | Tx, _listingId: string, _sellerBusinessId: string): Promise<string[]> {
  // F8-STUB(A2): match the listing against active requests.
  return [];
}
