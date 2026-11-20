import type { Tx } from '../../db/index.js';

// F6 accept → "Deal agreed with … Mark … fulfilled?" (spec §9.4, `part_request_fulfil_prompt`). Called by `acceptOffer`
// in its transaction, after the deal row. Lane A3 owns this file.

/** Prompts the buyer for each of its active requests the deal's listing answers (a delivered reply or a match). */
export async function notifyFulfilPrompts(
  _tx: Tx,
  _d: { dealId: string; listingId: string; buyerBusinessId: string; sellerBusinessId: string },
): Promise<void> {
  // F8-STUB(A3): find the buyer's active requests linked to the listing and notify.
}
