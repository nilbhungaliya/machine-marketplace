import { eq, sql } from 'drizzle-orm';
import { milliToQuantity, quantityToMilli, type OfferView } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { chatThreads, offers } from '../../db/schema.js';
import { ConflictError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { emitToBusinesses } from '../chat/chat-emit.js';
import { insertCardMessage, insertSystemLine, recomputeTurns } from '../chat/thread-lines.js';
import { maybeReveal } from '../consent/contact-consent.service.js';
import { createDealFromOffer } from '../deals/deal-create.js';
import {
  assertOfferOpen,
  availableMilli,
  businessBlocked,
  isBlockedBetween,
  listingTakesOffers,
  loadThread,
  lockOfferForAction,
  notifyOffer,
} from './offer.service.js';
import { notYourTurn, offerNotOpen, otherSide } from './offer-rules.js';
import { emitOfferUpdated, loadOfferView, type OfferRow } from './offer-view.js';
import { closeThreadChainsBlocked, reconcileOffersForListing } from './reconcile.js';

/**
 * Accept (F6 + F7 spec §7.6, R15; ported from textile `offer.service.ts` `acceptOffer`). One transaction, the §8.5
 * order listing → offer → deal (+ hold) → thread:
 * 1. refusals: `409 OFFER_NOT_OPEN`, `OFFER_EXPIRED`, `OFFER_NEEDS_RECONFIRM`, `NOT_YOUR_TURN`, the listing public and
 *    `live` / `reserved` (else `OFFER_NOT_OPEN` with `reason: 'listing_unavailable'`);
 * 2. too little available → the offer becomes a `backup` and **that commits**: the result is `backup`, which the route
 *    answers as `409 QUANTITY_NOT_AVAILABLE` (stored for a retried key, P11) — nothing is thrown;
 * 3. else the deal and its hold (`createDealFromOffer`), the offer `accepted`, reconcile (other offers that no longer
 *    fit become backups), `deal_count + 1`, the deal card and `deal_agreed` line, the reveal check, `offer_accepted` to
 *    the other side, `offer:updated` per reader and `deal:updated` to both businesses (ids only).
 * Two accepts for the last units serialise on the listing lock; the second finds its offer a backup already
 * (reconcile) or too little stock.
 *
 * A blocked pair (checked under the listing lock, final review: block race): the thread's open chains close
 * (`blocked`, as `closeChainsBetween`) and **that commits**; the result is `blocked`, answered `403 BUSINESS_BLOCKED`.
 */

export type AcceptResult =
  | { outcome: 'accepted'; dealId: string; offer: OfferView }
  | { outcome: 'backup'; available: string; offerId: string }
  | { outcome: 'blocked' };

/** The stored body of the committed block refusal. */
export function businessBlockedBody(): { error: string; code: string } {
  const err = businessBlocked();
  return { error: err.message, code: err.code };
}

/** The stored body of the committed refusal (§7.6, P11). */
export function quantityNotAvailableBody(available: string): { error: string; code: string; details: { available: string } } {
  return { error: 'That much is no longer available', code: 'QUANTITY_NOT_AVAILABLE', details: { available } };
}

async function moveToBackup(tx: Tx, offer: OfferRow, actorSide: 'buyer' | 'seller'): Promise<OfferRow> {
  const [backup] = await tx
    .update(offers)
    .set({ status: 'backup', backupSince: sql`now()`, expiresAt: null, updatedAt: sql`now()` })
    .where(eq(offers.id, offer.id))
    .returning();
  await insertSystemLine(tx, offer.threadId, 'offer_backup', { offerId: offer.id }, { actorSide });
  // P14: the buyer hears only when the seller's accept moved it (a buyer accepting a counter sees the 409 itself).
  if (actorSide === 'seller') {
    await notifyOffer(tx, 'offer_backup', backup!, 'buyer', `offer_backup:${offer.id}:${backup!.backupSince!.toISOString()}`);
  }
  return backup!;
}

export async function acceptOffer(tx: Tx, user: UserTokenPayload, offerId: string): Promise<AcceptResult> {
  const { listing, offer, reader, thread } = await lockOfferForAction(tx, user, offerId);
  if (await isBlockedBetween(tx, offer.buyerBusinessId, offer.sellerBusinessId)) {
    await closeThreadChainsBlocked(tx, thread.id);
    return { outcome: 'blocked' };
  }
  // Lost the race for the last units (the other accept moved this row to backup first): the same answer as a move.
  if (offer.status === 'backup') {
    const body = quantityNotAvailableBody(milliToQuantity(availableMilli(listing)));
    throw new ConflictError(body.error, body.code, body.details);
  }
  await assertOfferOpen(tx, offer);
  // Before the turn: a revived seller row is the seller's turn, and the buyer is told why it can't take it yet.
  if (offer.needsReconfirm) throw new ConflictError('The seller must reconfirm this offer first', 'OFFER_NEEDS_RECONFIRM');
  if (reader.side !== offer.turn) throw notYourTurn();
  if (!(await listingTakesOffers(tx, listing.id))) throw offerNotOpen(offer.status, 'listing_unavailable');

  const available = availableMilli(listing);
  if (quantityToMilli(offer.quantity) > available) {
    const backup = await moveToBackup(tx, offer, reader.side);
    await recomputeTurns(tx, thread.id);
    await emitOfferUpdated(tx, await loadThread(tx, thread.id), backup);
    return { outcome: 'backup', available: milliToQuantity(available), offerId: offer.id };
  }

  const deal = await createDealFromOffer(tx, offer, listing, { userId: user.userId, side: reader.side });
  const [accepted] = await tx
    .update(offers)
    .set({ status: 'accepted', answeredAt: sql`now()`, answeredByUserId: user.userId, updatedAt: sql`now()` })
    .where(eq(offers.id, offer.id))
    .returning();
  await reconcileOffersForListing(tx, listing.id);

  await tx
    .update(chatThreads)
    .set({ dealCount: sql`${chatThreads.dealCount} + 1`, updatedAt: sql`now()` })
    .where(eq(chatThreads.id, thread.id));
  await insertCardMessage(tx, thread.id, { kind: 'deal', dealId: deal.dealId, senderSide: reader.side, senderUserId: user.userId });
  await insertSystemLine(tx, thread.id, 'deal_agreed', { dealId: deal.dealId, ref: deal.ref }, { actorSide: reader.side });
  await maybeReveal(tx, thread.id);
  await notifyOffer(tx, 'offer_accepted', accepted!, otherSide(reader.side), `offer_accepted:${offer.id}`, { dealId: deal.dealId });

  await recomputeTurns(tx, thread.id);
  const fresh = await loadThread(tx, thread.id);
  await emitOfferUpdated(tx, fresh, accepted!);
  emitToBusinesses(tx, [offer.buyerBusinessId, offer.sellerBusinessId], 'deal:updated', {
    dealId: deal.dealId,
    threadId: thread.id,
    status: deal.status,
    version: deal.version,
  });
  return { outcome: 'accepted', dealId: deal.dealId, offer: await loadOfferView(tx, accepted!, reader, fresh) };
}
