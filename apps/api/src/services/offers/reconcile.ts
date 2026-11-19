import { and, asc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm';
import { quantityToMilli, type OfferCloseReason, type OfferKind } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { listings, offers } from '../../db/schema.js';
import { insertSystemLine, recomputeTurns } from '../chat/thread-lines.js';
import { lockListingsInOrder } from '../deals/locks.js';
import { getSettings } from '../settings.service.js';
import { availableMilli, listingTakesOffers, loadThread, notifyOffer } from './offer.service.js';
import { KIND_PRICE_MODEL } from './offer-rules.js';
import { emitOfferUpdated, type OfferRow } from './offer-view.js';

/**
 * Keeping open offers consistent with stock and with who may trade (F6 + F7 spec §7.5, §7.7, R15; ported from textile
 * `reconcile.ts`, D4). One function reads the listing as it is now and moves its open (`pending` / `backup`) rows to
 * match, so it is safe after any change and twice (the second call changes nothing). Callers hold the listing lock
 * (§8.5); this locks the listing again (a no-op), then its open offers in id order, then each thread (lines).
 *
 * A call that changes nothing writes nothing and queues nothing, so listing writers without offers are unaffected.
 */

const OPEN: Array<'pending' | 'backup'> = ['pending', 'backup'];

/** Opening kinds of the given negotiations (the chain's kind is its first row's, §5.6). */
async function openingKinds(tx: Tx, negotiationIds: string[]): Promise<Map<string, OfferKind>> {
  const ids = [...new Set(negotiationIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx.select({ id: offers.id, kind: offers.kind }).from(offers).where(inArray(offers.id, ids));
  return new Map(rows.map((r) => [r.id, r.kind]));
}

/** Closes rows (`closed` + reason), one `offers_closed` line per thread, turns recomputed, `offer:updated` per reader. */
async function closeRows(tx: Tx, rows: OfferRow[], reason: OfferCloseReason): Promise<void> {
  if (rows.length === 0) return;
  const closed = await tx
    .update(offers)
    .set({ status: 'closed', closeReason: reason, updatedAt: sql`now()` })
    .where(and(inArray(offers.id, rows.map((r) => r.id)), inArray(offers.status, OPEN)))
    .returning();
  const byThread = new Map<string, OfferRow[]>();
  for (const row of closed) byThread.set(row.threadId, [...(byThread.get(row.threadId) ?? []), row]);
  for (const [threadId, threadRows] of byThread) {
    await insertSystemLine(tx, threadId, 'offers_closed', { reason });
    await recomputeTurns(tx, threadId);
    const thread = await loadThread(tx, threadId);
    for (const row of threadRows) await emitOfferUpdated(tx, thread, row);
  }
}

/** Open rows of one listing, locked in id order (§8.5). */
async function lockOpenRows(tx: Tx, listingId: string, extra?: SQL): Promise<OfferRow[]> {
  return tx
    .select()
    .from(offers)
    .where(and(eq(offers.listingId, listingId), inArray(offers.status, OPEN), extra))
    .orderBy(asc(offers.id))
    .for('update');
}

/**
 * §7.7: the listing not taking offers (not `live` / `reserved`, or failing `publicListingWhere`) → every open row
 * `closed` (`listing_unavailable`); a chain whose opening kind no longer fits the price model → `closed`
 * (`listing_changed`); a `pending` row above available → `backup` (`backup_since`, no expiry, `offer_backup` line,
 * the buyer told); a `backup` that fits → `pending`, turn seller, a fresh validity of its length, `needs_reconfirm`
 * when the seller sent it (`offer_revived` line, the seller told).
 */
export async function reconcileOffersForListing(tx: Tx, listingId: string): Promise<void> {
  const [listing] = await tx.select().from(listings).where(eq(listings.id, listingId)).for('update');
  if (!listing) return;
  const open = await lockOpenRows(tx, listingId);
  if (open.length === 0) return;

  if (!(await listingTakesOffers(tx, listingId))) {
    await closeRows(tx, open, 'listing_unavailable');
    return;
  }

  const kinds = await openingKinds(tx, open.map((r) => r.negotiationId));
  const unfit = open.filter((r) => KIND_PRICE_MODEL[kinds.get(r.negotiationId) ?? r.kind] !== listing.priceModel);
  await closeRows(tx, unfit, 'listing_changed');

  const available = availableMilli(listing);
  // Past-due rows (a lapsed pending offer, a backup past its limit) are left for `offer-expiry`, never moved here.
  const { offer_backup_max_days: backupDays } = await getSettings(tx);
  const changedThreads = new Map<string, OfferRow[]>();
  for (const row of open) {
    if (unfit.includes(row)) continue;
    const qty = quantityToMilli(row.quantity);
    if (row.status === 'pending' && qty > available) {
      const [backup] = await tx
        .update(offers)
        .set({ status: 'backup', backupSince: sql`now()`, expiresAt: null, updatedAt: sql`now()` })
        .where(and(eq(offers.id, row.id), eq(offers.status, 'pending'), gt(offers.expiresAt, sql`now()`)))
        .returning();
      if (!backup) continue;
      await insertSystemLine(tx, row.threadId, 'offer_backup', { offerId: row.id });
      await notifyOffer(tx, 'offer_backup', backup, 'buyer', `offer_backup:${row.id}:${backup.backupSince!.toISOString()}`);
      changedThreads.set(row.threadId, [...(changedThreads.get(row.threadId) ?? []), backup]);
    } else if (row.status === 'backup' && qty <= available) {
      const [revived] = await tx
        .update(offers)
        .set({
          status: 'pending',
          turn: 'seller',
          needsReconfirm: row.senderSide === 'seller',
          expiresAt: sql`now() + make_interval(hours => ${row.validityHours}::int)`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(offers.id, row.id),
            eq(offers.status, 'backup'),
            gt(offers.backupSince, sql`now() - make_interval(days => ${backupDays}::int)`),
          ),
        )
        .returning();
      if (!revived) continue;
      await insertSystemLine(tx, row.threadId, 'offer_revived', { offerId: row.id });
      await notifyOffer(tx, 'offer_revived', revived, 'seller', `offer_revived:${row.id}:${revived.expiresAt!.toISOString()}`);
      changedThreads.set(row.threadId, [...(changedThreads.get(row.threadId) ?? []), revived]);
    }
  }
  for (const [threadId, rows] of changedThreads) {
    await recomputeTurns(tx, threadId);
    const thread = await loadThread(tx, threadId);
    for (const row of rows) await emitOfferUpdated(tx, thread, row);
  }
}

/**
 * Closes the open rows matching `which` with `reason`: their listings locked in id order first (plan review I7), then
 * each listing's matching rows in id order.
 */
async function closeOpenRowsWhere(tx: Tx, which: SQL, reason: OfferCloseReason): Promise<void> {
  const listingIds = (
    await tx
      .selectDistinct({ listingId: offers.listingId })
      .from(offers)
      .where(and(inArray(offers.status, OPEN), which))
  ).map((r) => r.listingId);
  if (listingIds.length === 0) return;
  const locked = await lockListingsInOrder(tx, listingIds);
  for (const listing of locked) {
    await closeRows(tx, await lockOpenRows(tx, listing.id, which), reason);
  }
}

/**
 * A block between two businesses closes every open chain between them, both directions (`blocked`, §6.11). The caller
 * (L1's block) writes its own `blocked` line afterwards. Closed rows stay closed after an unblock.
 */
export async function closeChainsBetween(tx: Tx, businessA: string, businessB: string): Promise<void> {
  const between = or(
    and(eq(offers.buyerBusinessId, businessA), eq(offers.sellerBusinessId, businessB)),
    and(eq(offers.buyerBusinessId, businessB), eq(offers.sellerBusinessId, businessA)),
  )!;
  await closeOpenRowsWhere(tx, between, 'blocked');
}

/**
 * An owner suspended or blocked (§7.7): the chains where the business is the **buyer** close (`account_inactive`).
 * Its own listings' chains close through `reconcileOffersForListing` (they fail `publicListingWhere`), which the caller
 * runs first. Closed rows stay closed after a reinstatement.
 */
export async function closeChainsForInactiveOwner(tx: Tx, businessId: string): Promise<void> {
  await closeOpenRowsWhere(tx, eq(offers.buyerBusinessId, businessId), 'account_inactive');
}

/** Listings with open rows where the business is seller or buyer (the suspension locks them all, in id order, first). */
export async function openOfferListingIds(tx: Tx, businessId: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ listingId: offers.listingId })
    .from(offers)
    .where(and(inArray(offers.status, OPEN), or(eq(offers.sellerBusinessId, businessId), eq(offers.buyerBusinessId, businessId))));
  return rows.map((r) => r.listingId);
}
