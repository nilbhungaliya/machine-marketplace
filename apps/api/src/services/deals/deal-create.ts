import { eq } from 'drizzle-orm';
import type { PartySide } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { dealEvents, deals, units } from '../../db/schema.js';
import type { ListingRow } from '../listings/locks.js';
import type { OfferRow } from '../offers/offer-view.js';
import { placeHold } from './holds.js';

/**
 * A deal from an accepted offer (F6 + F7 spec §7.6 step 2, §9.1; ported from textile `deal.service.ts`
 * `createDealFromOffer`, D3). The deal row first, with the offer's terms and the listing's snapshots (title, unit,
 * GST mode), then its `agreed` timeline event, then its hold (`placeHold`: `held_quantity += quantity` and
 * `syncReservation`). The caller holds the listing lock and has checked the stock: a `placeHold` refusal throws and the
 * whole accept rolls back.
 */
export async function createDealFromOffer(
  tx: Tx,
  offer: OfferRow,
  listing: ListingRow,
  actor: { userId: string; side: PartySide },
): Promise<{ dealId: string; ref: number; status: 'agreed'; version: number }> {
  const [unit] = offer.unitId ? await tx.select({ label: units.label }).from(units).where(eq(units.id, offer.unitId)) : [];
  const [deal] = await tx
    .insert(deals)
    .values({
      threadId: offer.threadId,
      listingId: offer.listingId,
      offerId: offer.id,
      buyerBusinessId: offer.buyerBusinessId,
      sellerBusinessId: offer.sellerBusinessId,
      listingTitle: listing.title ?? '',
      unitId: offer.unitId,
      unitLabel: unit?.label ?? '',
      gstMode: offer.gstMode,
      pricePerUnitPaise: offer.pricePerUnitPaise,
      quantity: offer.quantity,
      totalPaise: offer.totalPaise,
      status: 'agreed',
      acceptedByUserId: actor.userId,
    })
    .returning({ id: deals.id, ref: deals.ref, version: deals.version });
  await tx.insert(dealEvents).values({
    dealId: deal!.id,
    code: 'agreed',
    actorSide: actor.side,
    actorUserId: actor.userId,
    values: { offerId: offer.id },
  });
  await placeHold(tx, listing, deal!.id, offer.quantity);
  return { dealId: deal!.id, ref: deal!.ref, status: 'agreed', version: deal!.version };
}
