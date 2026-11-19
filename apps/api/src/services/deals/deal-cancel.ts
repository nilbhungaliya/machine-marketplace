import { and, asc, eq } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { deals } from '../../db/schema.js';
import { afterDealChange, applyCancellation, notifyDealSide } from './deal.service.js';

/**
 * Deal cancellation by the system (F6 + F7 spec §8.3, §9.2, §26 17). L3-2 owns this file; the parties' cancels live in
 * `deal.service.ts`.
 */

/**
 * An admin removed the listing (`adminListingAction('remove')`, which holds the listing's lock): its `agreed` deals
 * are cancelled by the system (reason `listing_removed`), holds released; `handed_over` / `disputed` deals continue as
 * records and complete normally. Deals are locked in id order (§8.5: listing → deal). Both sides are told
 * (`deal_cancelled`: a system event, P14). The caller's `afterListingStatusWrite` reconciles the listing's offers.
 */
export async function cancelAgreedDealsForRemovedListing(tx: Tx, listingId: string, adminId: string): Promise<void> {
  const open = await tx
    .select()
    .from(deals)
    .where(and(eq(deals.listingId, listingId), eq(deals.status, 'agreed')))
    .orderBy(asc(deals.id))
    .for('update');
  for (const deal of open) {
    const updated = await applyCancellation(
      tx,
      deal,
      // No reconcile here: the caller's `afterListingStatusWrite` reconciles once the listing is removed, so backups
      // aren't revived (and notified) only to be closed.
      {
        by: 'system',
        actor: { side: 'system', userId: null, adminId },
        reason: 'listing_removed',
        note: null,
        stock: 'release',
        reconcile: false,
      },
      ['agreed'],
    );
    if (!updated) continue;
    await notifyDealSide(tx, updated, 'buyer', 'deal_cancelled', `deal_cancelled:${updated.id}`);
    await notifyDealSide(tx, updated, 'seller', 'deal_cancelled', `deal_cancelled:${updated.id}`);
    await afterDealChange(tx, updated);
  }
}
