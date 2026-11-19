import type { Tx } from '../../db/index.js';

/**
 * Keeping open offers consistent with stock and with who may trade (F6 + F7 spec §7.6–§7.8, R15; textile reconcile).
 * L2-4 owns this file. Callers hold the listing lock (§8.5).
 */

/** Pending offers whose quantity no longer fits become backups; backups that fit again revive (seller re-confirms). */
// F6F7-STUB(L2): L2-4 implements reconcile.
export async function reconcileOffersForListing(_tx: Tx, _listingId: string): Promise<void> {
  return;
}

/** A block between two businesses closes every open chain between them (both directions). */
// F6F7-STUB(L2): L2-4 implements the block close.
export async function closeChainsBetween(_tx: Tx, _businessA: string, _businessB: string): Promise<void> {
  return;
}

/** An owner suspended or blocked: the business's open chains (as buyer and as seller) close. */
// F6F7-STUB(L2): L2-4 implements the suspension close.
export async function closeChainsForInactiveOwner(_tx: Tx, _businessId: string): Promise<void> {
  return;
}
