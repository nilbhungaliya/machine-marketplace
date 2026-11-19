import type { Tx } from '../../db/index.js';

/**
 * Deal cancellation (F6 + F7 spec §9.4). L3-2 owns this file.
 */

/** An admin removed the listing: its `agreed` deals are cancelled by the system (reason `listing_removed`). */
// F6F7-STUB(L3): L3-2 implements the cancel.
export async function cancelAgreedDealsForRemovedListing(_tx: Tx, _listingId: string, _adminId: string): Promise<void> {
  return;
}
