import { randomUUID } from 'node:crypto';
import { and, count, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  MAX_COUNTER_ROUNDS,
  counterBounds,
  quantityToMilli,
  totalPaise,
  type NotificationType,
  type OfferKind,
  type OffersOptions,
  type OfferView,
  type PartySide,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businessBlocks, businesses, chatThreads, listings, offers, units, users } from '../../db/schema.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { publicText } from '../chat/chat-view.js';
import { assertCanWrite, getThreadForParty, type ChatReader, type ThreadRow } from '../chat/members.js';
import { openOrGetThread } from '../chat/open-thread.js';
import { looksLikeScam } from '../chat/scam-patterns.js';
import { insertCardMessage, insertSystemLine, recomputeTurns } from '../chat/thread-lines.js';
import { lockBuyerBusiness, lockOffers } from '../deals/locks.js';
import { listingNotFound, lockListingOnly, type ListingRow } from '../listings/locks.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import { notify } from '../notifications/notify.js';
import { getSettings } from '../settings.service.js';
import {
  KIND_PRICE_MODEL,
  assertPrice,
  checkNote,
  checkQuantity,
  checkValidity,
  notYourTurn,
  offerExpired,
  offerNotFound,
  offerNotOpen,
  otherSide,
  validateOfferInput,
  validityChoices,
  type ListingForOffer,
} from './offer-rules.js';
import { chainContext, emitOfferUpdated, loadOfferView, type OfferRow } from './offer-view.js';

/**
 * The offer state machine (F6 + F7 spec §7, R11–R15; ported from textile `offer.service.ts` without lots, payment
 * terms, samples or inspections). Every action runs in the route's transaction (`runIdempotent` → `runTx`) and follows
 * the §8.5 lock order: buyer business (only where the open-offer limit is counted) → listing → offer(s) → thread (card
 * and system lines take it last). Every transition writes its card or line, its notification (§11.3), recomputes the
 * thread's turns and queues `offer:updated` per reader.
 */

type Conn = Db | Tx;

export interface OfferTermsBody {
  pricePerUnitPaise?: number;
  quantity: string;
  validityHours?: number;
  note?: string | null;
}

// ─── Shared helpers ───

/** A listing that takes offers now: public (`publicListingWhere`) and `live` or `reserved` (§7.6). */
export async function listingTakesOffers(conn: Conn, listingId: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.id, listingId), publicListingWhere(), inArray(listings.status, ['live', 'reserved'])));
  return row !== undefined;
}

/** The listing's fields the quantity and price checks read, with its unit's decimals. */
export async function listingForOffer(conn: Conn, listing: ListingRow): Promise<ListingForOffer> {
  const [unit] = listing.unitId ? await conn.select({ decimals: units.decimals }).from(units).where(eq(units.id, listing.unitId)) : [];
  return { pricePaise: listing.pricePaise, minOrderQty: listing.minOrderQty, unitDecimals: unit?.decimals ?? 0 };
}

/** `quantity − held_quantity` in thousandths (0 for a listing without a quantity). */
export function availableMilli(listing: Pick<ListingRow, 'quantity' | 'heldQuantity'>): bigint {
  if (listing.quantity === null) return 0n;
  const a = quantityToMilli(listing.quantity) - quantityToMilli(listing.heldQuantity);
  return a < 0n ? 0n : a;
}

/** `pending` and unexpired by the database clock (§7.5), else `409 OFFER_NOT_OPEN` / `OFFER_EXPIRED`. */
export async function assertOfferOpen(tx: Tx, offer: OfferRow): Promise<void> {
  if (offer.status !== 'pending') throw offerNotOpen(offer.status);
  if (await isExpired(tx, offer)) throw offerExpired();
}

async function isExpired(tx: Tx, offer: Pick<OfferRow, 'expiresAt'>): Promise<boolean> {
  if (offer.expiresAt === null) return false;
  const { rows } = await tx.execute(sql`SELECT ${offer.expiresAt.toISOString()}::timestamptz <= now() AS expired`);
  return (rows[0] as { expired: boolean }).expired;
}

async function memberRoleOf(conn: Conn, userId: string) {
  const [row] = await conn.select({ memberRole: users.memberRole }).from(users).where(eq(users.id, userId));
  return row?.memberRole ?? 'viewer';
}

export async function loadThread(conn: Conn, threadId: string): Promise<ThreadRow> {
  const [thread] = await conn.select().from(chatThreads).where(eq(chatThreads.id, threadId));
  if (!thread) throw new Error(`thread ${threadId} missing`);
  return thread;
}

/**
 * The offer the caller's business is a party to, its listing locked and then the offer locked (§8.5), and the caller
 * as a reader. `404 OFFER_NOT_FOUND` for anyone else; `403 VIEWER_READ_ONLY` for a viewer. The thread is read, not
 * locked (cards and lines lock it last).
 */
export async function lockOfferForAction(
  tx: Tx,
  user: UserTokenPayload,
  offerId: string,
): Promise<{ listing: ListingRow; offer: OfferRow; reader: ChatReader; thread: ThreadRow }> {
  const [seen] = await tx.select({ listingId: offers.listingId, buyer: offers.buyerBusinessId, seller: offers.sellerBusinessId }).from(offers).where(eq(offers.id, offerId));
  if (!seen || !user.businessId || (seen.buyer !== user.businessId && seen.seller !== user.businessId)) throw offerNotFound();
  const side: PartySide = seen.buyer === user.businessId ? 'buyer' : 'seller';
  const reader: ChatReader = { userId: user.userId, businessId: user.businessId, memberRole: await memberRoleOf(tx, user.userId), side };
  assertCanWrite(reader);
  const listing = await lockListingOnly(tx, seen.listingId);
  const [offer] = await lockOffers(tx, [offerId]);
  if (!offer) throw offerNotFound();
  return { listing, offer, reader, thread: await loadThread(tx, offer.threadId) };
}

/** Seller's first answer (a reject or reconfirm writes only a system line): `first_seller_reply_at` (§6.2). */
export async function markSellerReplied(tx: Tx, threadId: string): Promise<void> {
  await tx
    .update(chatThreads)
    .set({ firstSellerReplyAt: sql`coalesce(${chatThreads.firstSellerReplyAt}, now())` })
    .where(eq(chatThreads.id, threadId));
}

/**
 * One offer notification to `side`'s business (§11.3). Params are safe values only (§11.4): the other business's name
 * and the listing title, both masked, price per unit and quantity.
 */
export async function notifyOffer(
  tx: Tx,
  type: NotificationType,
  offer: OfferRow,
  side: PartySide,
  dedupeKey: string,
  extra: { dealId?: string } = {},
): Promise<void> {
  const counterpartId = side === 'buyer' ? offer.sellerBusinessId : offer.buyerBusinessId;
  const [names] = await tx
    .select({ businessName: businesses.tradeName, listingTitle: listings.title })
    .from(listings)
    .innerJoin(businesses, eq(businesses.id, counterpartId))
    .where(eq(listings.id, offer.listingId));
  await notify(tx, {
    type,
    recipientBusinessId: side === 'buyer' ? offer.buyerBusinessId : offer.sellerBusinessId,
    params: {
      businessName: publicText(names?.businessName ?? null),
      listingTitle: publicText(names?.listingTitle ?? null),
      pricePerUnitPaise: offer.pricePerUnitPaise,
      quantity: offer.quantity,
    },
    destination: { threadId: offer.threadId, offerId: offer.id, ...(extra.dealId ? { dealId: extra.dealId } : {}) },
    dedupeKey,
  });
}

/** Turns, then `offer:updated` for each changed row (per reader). */
async function afterChange(tx: Tx, threadId: string, rows: OfferRow[]): Promise<void> {
  await recomputeTurns(tx, threadId);
  const thread = await loadThread(tx, threadId);
  for (const row of rows) await emitOfferUpdated(tx, thread, row);
}

async function assertNoOpenNegotiation(tx: Tx, threadId: string): Promise<void> {
  const [open] = await tx
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.threadId, threadId), inArray(offers.status, ['pending', 'backup'])))
    .limit(1);
  if (open) throw new ConflictError('A negotiation is already open in this chat', 'NEGOTIATION_OPEN', { offerId: open.id });
}

async function assertNotBlocked(tx: Tx, a: string, b: string): Promise<void> {
  const [block] = await tx
    .select({ one: sql<number>`1` })
    .from(businessBlocks)
    .where(
      or(
        and(eq(businessBlocks.blockerBusinessId, a), eq(businessBlocks.blockedBusinessId, b)),
        and(eq(businessBlocks.blockerBusinessId, b), eq(businessBlocks.blockedBusinessId, a)),
      ),
    )
    .limit(1);
  if (block) throw new ForbiddenError("You can't message this business", 'BUSINESS_BLOCKED');
}

// ─── Limits (§7.8) ───

const opening = alias(offers, 'opening');

/**
 * Open negotiations started by the buyer business (opening row `offer` or `buy_now`) whose latest row is `pending`.
 * Backups don't count; quotes (seller-started) don't; a negotiation counts once whoever sent its latest row.
 */
export async function openOfferCount(conn: Conn, buyerBusinessId: string): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(offers)
    .innerJoin(opening, eq(opening.id, offers.negotiationId))
    .where(and(eq(offers.buyerBusinessId, buyerBusinessId), eq(offers.status, 'pending'), inArray(opening.kind, ['offer', 'buy_now'])));
  return row?.n ?? 0;
}

async function openLimitOf(conn: Conn, business: { verificationLevels: string[] }): Promise<number> {
  const settings = await getSettings(conn);
  return business.verificationLevels.includes('gst') ? settings.offer_open_limit_verified : settings.offer_open_limit_unverified;
}

/** The caller holds the buyer business lock (`FOR NO KEY UPDATE`), so two first offers can't both pass. */
async function assertUnderOfferLimit(tx: Tx, business: { id: string; verificationLevels: string[] }): Promise<void> {
  const limit = await openLimitOf(tx, business);
  if ((await openOfferCount(tx, business.id)) >= limit) {
    throw new ConflictError(`You can have ${limit} open offers at a time`, 'OFFER_LIMIT_REACHED', { limit });
  }
}

/** `GET /offers/options` (§12.2). */
export async function offersOptions(conn: Conn, user: UserTokenPayload): Promise<OffersOptions> {
  if (!user.businessId) throw new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
  const settings = await getSettings(conn);
  const { choices, defaultHours } = validityChoices(settings);
  const [business] = await conn.select({ id: businesses.id, verificationLevels: businesses.verificationLevels }).from(businesses).where(eq(businesses.id, user.businessId));
  return {
    validityHours: choices,
    defaultValidityHours: defaultHours,
    maxCounterRounds: MAX_COUNTER_ROUNDS,
    openLimit: await openLimitOf(conn, business ?? { verificationLevels: [] }),
    openCount: await openOfferCount(conn, user.businessId),
  };
}

// ─── Sending (§7.1–§7.3) ───

function rentalRefusal(): ConflictError {
  return new ConflictError('Rentals take enquiries only', 'OFFERS_NOT_FOR_RENTALS');
}

/**
 * Make offer / Buy at this price (§7.1, §7.2, R11, R12). Refusals: not public → `404 LISTING_NOT_FOUND`; rental →
 * `409 OFFERS_NOT_FOR_RENTALS`; the button doesn't fit the price model → `409 PRICE_MODEL_MISMATCH`; then the thread's
 * own refusals (`openOrGetThread`: own listing, viewer, block, daily new-thread limit); an open chain in the thread →
 * `409 NEGOTIATION_OPEN`; the open-offer limit → `409 OFFER_LIMIT_REACHED`; the terms (`validateOfferInput`).
 * Locks: buyer business → listing → (thread created) → thread for the card.
 */
export async function sendOffer(
  tx: Tx,
  user: UserTokenPayload,
  listingId: string,
  input: OfferTermsBody & { kind: 'offer' | 'buy_now' },
): Promise<{ threadId: string; offer: OfferView }> {
  const [pre] = await tx
    .select({ kind: listings.kind, priceModel: listings.priceModel })
    .from(listings)
    .where(and(eq(listings.id, listingId), publicListingWhere()));
  if (!pre) throw listingNotFound();
  if (!user.businessId) throw new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
  if (pre.kind === 'machine_rental') throw rentalRefusal();
  if (pre.priceModel !== KIND_PRICE_MODEL[input.kind]) {
    throw new ConflictError("This listing's price doesn't take that", 'PRICE_MODEL_MISMATCH', { priceModel: pre.priceModel });
  }

  // §8.5: buyer business, then the listing, then the thread (created by openOrGetThread after the listing lock, so no
  // transaction holds a key-share on the listing from its thread insert while it waits to lock the listing).
  const business = await lockBuyerBusiness(tx, user.businessId);
  let listing = await lockListingOnly(tx, listingId);
  const { thread, reader } = await openOrGetThread(tx, user, listingId);

  // Re-read under the lock: the listing may have changed since the pre-read (paused, owner suspended, model edited).
  if (!(await listingTakesOffers(tx, listingId))) throw listingNotFound();
  listing = await lockListingOnly(tx, listingId);
  if (listing.priceModel !== KIND_PRICE_MODEL[input.kind]) {
    throw new ConflictError("This listing's price doesn't take that", 'PRICE_MODEL_MISMATCH', { priceModel: listing.priceModel });
  }
  await assertNoOpenNegotiation(tx, thread.id);
  await assertUnderOfferLimit(tx, business);

  const settings = await getSettings(tx);
  const terms = validateOfferInput(await listingForOffer(tx, listing), input, { kind: input.kind, available: availableMilli(listing), settings });
  const id = randomUUID();
  const [row] = await tx
    .insert(offers)
    .values({
      id,
      threadId: thread.id,
      listingId,
      buyerBusinessId: thread.buyerBusinessId,
      sellerBusinessId: thread.sellerBusinessId,
      negotiationId: id,
      round: 0,
      kind: input.kind,
      senderSide: 'buyer',
      senderUserId: user.userId,
      turn: 'seller',
      pricePerUnitPaise: terms.pricePerUnitPaise,
      quantity: terms.quantity,
      totalPaise: terms.totalPaise,
      askingPricePaise: listing.pricePaise,
      unitId: listing.unitId,
      gstMode: listing.gstMode,
      validityHours: terms.validityHours,
      expiresAt: sql`now() + make_interval(hours => ${terms.validityHours}::int)`,
      note: terms.note,
      scamFlag: terms.note !== null && looksLikeScam(terms.note),
      status: 'pending',
    })
    .returning();

  await insertCardMessage(tx, thread.id, { kind: 'offer', offerId: id, senderSide: 'buyer', senderUserId: user.userId });
  await notifyOffer(tx, 'offer_new', row!, 'seller', `offer_new:${id}`);
  await afterChange(tx, thread.id, [row!]);
  return { threadId: thread.id, offer: await loadOfferView(tx, row!, reader, await loadThread(tx, thread.id)) };
}

/**
 * The seller's quote on a price-on-request listing (§7.3, R13): round 0, sender seller, turn buyer, no asking snapshot.
 * Refusals: a buyer, or another price model → `409 QUOTE_NOT_ALLOWED`; rental → `OFFERS_NOT_FOR_RENTALS`; an open
 * chain → `NEGOTIATION_OPEN`. Doesn't count toward the buyer's limit. Locks: listing → thread.
 */
export async function sendQuote(tx: Tx, user: UserTokenPayload, threadId: string, input: OfferTermsBody): Promise<OfferView> {
  const { thread, reader } = await getThreadForParty(tx, user, threadId);
  assertCanWrite(reader);
  if (reader.side !== 'seller') throw new ConflictError('Only the seller sends a quote', 'QUOTE_NOT_ALLOWED', { reason: 'seller_only' });
  const listing = await lockListingOnly(tx, thread.listingId);
  if (listing.kind === 'machine_rental') throw rentalRefusal();
  if (listing.priceModel !== 'on_request') throw new ConflictError('Quotes are for price-on-request listings', 'QUOTE_NOT_ALLOWED', { priceModel: listing.priceModel });
  if (!(await listingTakesOffers(tx, listing.id))) throw new ConflictError('This listing is not taking offers', 'QUOTE_NOT_ALLOWED', { reason: 'listing_unavailable' });
  await assertNotBlocked(tx, thread.buyerBusinessId, thread.sellerBusinessId);
  await assertNoOpenNegotiation(tx, thread.id);

  const settings = await getSettings(tx);
  const terms = validateOfferInput(await listingForOffer(tx, listing), input, { kind: 'quote', available: availableMilli(listing), settings });
  const id = randomUUID();
  const [row] = await tx
    .insert(offers)
    .values({
      id,
      threadId: thread.id,
      listingId: listing.id,
      buyerBusinessId: thread.buyerBusinessId,
      sellerBusinessId: thread.sellerBusinessId,
      negotiationId: id,
      round: 0,
      kind: 'quote',
      senderSide: 'seller',
      senderUserId: user.userId,
      turn: 'buyer',
      pricePerUnitPaise: terms.pricePerUnitPaise,
      quantity: terms.quantity,
      totalPaise: terms.totalPaise,
      askingPricePaise: null,
      unitId: listing.unitId,
      gstMode: listing.gstMode,
      validityHours: terms.validityHours,
      expiresAt: sql`now() + make_interval(hours => ${terms.validityHours}::int)`,
      note: terms.note,
      scamFlag: terms.note !== null && looksLikeScam(terms.note),
      status: 'pending',
    })
    .returning();

  // A seller-sent card sets `first_seller_reply_at` (thread-lines).
  await insertCardMessage(tx, thread.id, { kind: 'offer', offerId: id, senderSide: 'seller', senderUserId: user.userId });
  await notifyOffer(tx, 'offer_quote', row!, 'buyer', `offer_quote:${id}`);
  await afterChange(tx, thread.id, [row!]);
  return loadOfferView(tx, row!, reader, await loadThread(tx, thread.id));
}

// ─── Answering (§7.4, §7.5) ───

/**
 * The turn side counters (§7.4): rounds left (`409 COUNTER_LIMIT` after 5), not on a buy-now chain
 * (`409 COUNTER_NOT_ALLOWED`), the price within `counterBounds` (`400 COUNTER_OUT_OF_BOUNDS { min, max }`), a change
 * (`400 COUNTER_UNCHANGED`: the actor's own latest price and quantity), the quantity within minimum and available. The old
 * row → `countered`, a new `pending` row round + 1 with the turn swapped and a fresh validity.
 */
export async function counterOffer(tx: Tx, user: UserTokenPayload, offerId: string, input: OfferTermsBody): Promise<OfferView> {
  const { listing, offer, reader, thread } = await lockOfferForAction(tx, user, offerId);
  await assertOfferOpen(tx, offer);
  if (reader.side !== offer.turn) throw notYourTurn();
  const ctx = await chainContext(tx, offer);
  if (ctx.openingKind === 'buy_now') throw new ConflictError('Buy-at-this-price offers take no counters', 'COUNTER_NOT_ALLOWED');
  if (offer.round >= MAX_COUNTER_ROUNDS) throw new ConflictError(`After ${MAX_COUNTER_ROUNDS} counters, accept or reject this offer`, 'COUNTER_LIMIT');

  const price = assertPrice(input.pricePerUnitPaise);
  const bounds = counterBounds({ by: reader.side, buyerLatestPaise: ctx.buyerLatestPaise, sellerLatestPaise: ctx.sellerLatestPaise ?? offer.pricePerUnitPaise });
  if (price < bounds.minPaise || price > bounds.maxPaise) {
    throw new ValidationError('This price is outside the counter range', { min: bounds.minPaise, max: bounds.maxPaise }, 'COUNTER_OUT_OF_BOUNDS');
  }
  const quantity = checkQuantity(await listingForOffer(tx, listing), input.quantity, availableMilli(listing));
  // Unchanged = the actor's own latest row's price and quantity; a side with no row yet (the seller against the asking
  // snapshot) compares with the row it answers.
  const ownLatest = reader.side === 'buyer' ? ctx.buyerLatestPaise : ctx.sellerLatestPaise;
  const ownQuantity = (reader.side === 'buyer' ? ctx.buyerLatestQuantity : ctx.sellerLatestQuantity) ?? offer.quantity;
  if (price === ownLatest && quantityToMilli(quantity) === quantityToMilli(ownQuantity)) {
    throw new ValidationError('Change the price or the quantity to counter', undefined, 'COUNTER_UNCHANGED');
  }
  const settings = await getSettings(tx);
  const validityHours = checkValidity(input.validityHours, settings);
  const note = checkNote(input.note);

  const [old] = await tx
    .update(offers)
    .set({ status: 'countered', answeredAt: sql`now()`, answeredByUserId: user.userId, updatedAt: sql`now()` })
    .where(eq(offers.id, offer.id))
    .returning();
  const [next] = await tx
    .insert(offers)
    .values({
      threadId: offer.threadId,
      listingId: offer.listingId,
      buyerBusinessId: offer.buyerBusinessId,
      sellerBusinessId: offer.sellerBusinessId,
      negotiationId: offer.negotiationId,
      previousOfferId: offer.id,
      round: offer.round + 1,
      // §5.6: counters keep `offer`; the chain's kind is its opening row's.
      kind: 'offer' as OfferKind,
      senderSide: reader.side,
      senderUserId: user.userId,
      turn: otherSide(reader.side),
      pricePerUnitPaise: price,
      quantity,
      totalPaise: totalPaise(price, quantity),
      askingPricePaise: offer.askingPricePaise,
      unitId: offer.unitId,
      gstMode: offer.gstMode,
      validityHours,
      expiresAt: sql`now() + make_interval(hours => ${validityHours}::int)`,
      note,
      scamFlag: note !== null && looksLikeScam(note),
      status: 'pending',
    })
    .returning();

  await insertCardMessage(tx, thread.id, { kind: 'offer', offerId: next!.id, senderSide: reader.side, senderUserId: user.userId });
  await notifyOffer(tx, 'offer_countered', next!, otherSide(reader.side), `offer_countered:${next!.id}`);
  await afterChange(tx, thread.id, [old!, next!]);
  return loadOfferView(tx, next!, reader, await loadThread(tx, thread.id));
}

/** The turn side rejects (note ≤ 300): the negotiation ends; `offer_rejected` line; the sender's party is told. */
export async function rejectOffer(tx: Tx, user: UserTokenPayload, offerId: string, input: { note?: string | null }): Promise<OfferView> {
  const { offer, reader, thread } = await lockOfferForAction(tx, user, offerId);
  await assertOfferOpen(tx, offer);
  if (reader.side !== offer.turn) throw notYourTurn();
  const note = checkNote(input.note, 300);
  const [rejected] = await tx
    .update(offers)
    .set({ status: 'rejected', rejectNote: note, answeredAt: sql`now()`, answeredByUserId: user.userId, updatedAt: sql`now()` })
    .where(eq(offers.id, offer.id))
    .returning();
  await insertSystemLine(tx, thread.id, 'offer_rejected', { offerId: offer.id, side: reader.side }, { actorSide: reader.side });
  if (reader.side === 'seller') await markSellerReplied(tx, thread.id);
  // P14: never the actor's own business (a seller rejecting its own revived quote tells nobody).
  if (offer.senderSide !== reader.side) await notifyOffer(tx, 'offer_rejected', rejected!, offer.senderSide, `offer_rejected:${offer.id}`);
  await afterChange(tx, thread.id, [rejected!]);
  return loadOfferView(tx, rejected!, reader, await loadThread(tx, thread.id));
}

/**
 * Withdraw (§7.5): the sender, before any answer (`pending`, unexpired), or the buyer business on a `backup`; ends the
 * negotiation. Anyone else → `409 NOT_YOUR_TURN`.
 */
export async function withdrawOffer(tx: Tx, user: UserTokenPayload, offerId: string): Promise<OfferView> {
  const { offer, reader, thread } = await lockOfferForAction(tx, user, offerId);
  if (offer.status === 'backup') {
    if (reader.side !== 'buyer') throw notYourTurn();
  } else {
    await assertOfferOpen(tx, offer);
    if (reader.side !== offer.senderSide) throw notYourTurn();
  }
  const [withdrawn] = await tx
    .update(offers)
    .set({ status: 'withdrawn', updatedAt: sql`now()` })
    .where(eq(offers.id, offer.id))
    .returning();
  await insertSystemLine(tx, thread.id, 'offer_withdrawn', { offerId: offer.id, side: reader.side }, { actorSide: reader.side });
  await afterChange(tx, thread.id, [withdrawn!]);
  return loadOfferView(tx, withdrawn!, reader, await loadThread(tx, thread.id));
}

/**
 * The seller reconfirms a revived row it sent (§7.7): turn → buyer, a fresh validity of the row's length,
 * `offer_reconfirmed` line. The buyer → `409 NOT_YOUR_TURN`; a row that needs no reconfirming → `409 OFFER_NOT_OPEN`.
 */
export async function reconfirmOffer(tx: Tx, user: UserTokenPayload, offerId: string): Promise<OfferView> {
  const { offer, reader, thread } = await lockOfferForAction(tx, user, offerId);
  await assertOfferOpen(tx, offer);
  if (reader.side !== 'seller' || offer.turn !== 'seller') throw notYourTurn();
  if (!offer.needsReconfirm) throw offerNotOpen(offer.status, 'no_reconfirm_needed');
  const [reconfirmed] = await tx
    .update(offers)
    .set({
      needsReconfirm: false,
      turn: 'buyer',
      expiresAt: sql`now() + make_interval(hours => ${offer.validityHours}::int)`,
      updatedAt: sql`now()`,
    })
    .where(eq(offers.id, offer.id))
    .returning();
  await insertSystemLine(tx, thread.id, 'offer_reconfirmed', { offerId: offer.id }, { actorSide: 'seller' });
  await markSellerReplied(tx, thread.id);
  await afterChange(tx, thread.id, [reconfirmed!]);
  return loadOfferView(tx, reconfirmed!, reader, await loadThread(tx, thread.id));
}
