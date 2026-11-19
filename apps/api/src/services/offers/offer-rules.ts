import {
  DEAL_LIMITS,
  MAX_COUNTER_ROUNDS,
  fitsUnitDecimals,
  milliToQuantity,
  quantityToMilli,
  totalPaise,
  type AppSettingsValues,
  type MemberRole,
  type OfferAction,
  type OfferKind,
  type OfferStatus,
  type PartySide,
  type PriceModel,
} from '@mpm/shared-types';
import { AppError, ConflictError, ValidationError } from '../../lib/errors.js';

/**
 * Offer rules that need no database (F6 + F7 spec §7.1–§7.5; ported from textile `offer-terms.ts` without payment
 * terms, delivery or samples). Every money value is integer paise, every quantity a decimal string worked in
 * thousandths (`quantityToMilli`).
 */

const INT4_MAX = 2_147_483_647;

/** The price model each opening kind needs (§7.1); a chain whose listing no longer fits closes (`listing_changed`). */
export const KIND_PRICE_MODEL: Record<OfferKind, PriceModel> = {
  offer: 'negotiable',
  buy_now: 'fixed',
  quote: 'on_request',
};

export function otherSide(side: PartySide): PartySide {
  return side === 'buyer' ? 'seller' : 'buyer';
}

/** The three validity choices (settings `offer_validity_hours_1/2/3`), the middle one the default (§7.2). */
export function validityChoices(settings: AppSettingsValues): { choices: number[]; defaultHours: number } {
  const choices = [settings.offer_validity_hours_1, settings.offer_validity_hours_2, settings.offer_validity_hours_3];
  return { choices, defaultHours: settings.offer_validity_hours_2 };
}

/** What the listing contributes to an offer's checks. */
export interface ListingForOffer {
  pricePaise: number | null;
  minOrderQty: string | null;
  unitDecimals: number;
}

export interface OfferInput {
  pricePerUnitPaise?: number;
  quantity: string;
  validityHours?: number;
  note?: string | null;
}

export interface ResolvedOffer {
  pricePerUnitPaise: number;
  quantity: string;
  totalPaise: bigint;
  validityHours: number;
  note: string | null;
}

function priceError(): ValidationError {
  return new ValidationError('Enter a price above zero', undefined, 'VALIDATION_ERROR');
}

/** A whole number of paise, 1 … 2 147 483 647 (as listing prices, P4). */
export function assertPrice(paise: number | undefined): number {
  if (paise === undefined || !Number.isSafeInteger(paise) || paise < 1 || paise > INT4_MAX) throw priceError();
  return paise;
}

/**
 * Quantity rules (§7.2): positive, the unit's decimals (`400 QUANTITY_DECIMALS`), at most what is available
 * (`409 QUANTITY_NOT_AVAILABLE`), at least the minimum order (`400 QUANTITY_BELOW_MINIMUM`) — except that when
 * `0 < available < min_order_qty` exactly the whole available quantity is allowed. Returns the canonical string.
 */
export function checkQuantity(listing: ListingForOffer, quantity: string, available: bigint): string {
  let milli: bigint;
  try {
    milli = quantityToMilli(quantity);
  } catch {
    throw new ValidationError('Enter a quantity', undefined, 'VALIDATION_ERROR');
  }
  if (milli <= 0n) throw new ValidationError('Enter a quantity above zero', undefined, 'VALIDATION_ERROR');
  if (!fitsUnitDecimals(quantity, listing.unitDecimals)) {
    throw new ValidationError('This unit takes fewer decimals', { decimals: listing.unitDecimals }, 'QUANTITY_DECIMALS');
  }
  if (milli > available) {
    throw new ConflictError('That much is no longer available', 'QUANTITY_NOT_AVAILABLE', { available: milliToQuantity(available < 0n ? 0n : available) });
  }
  if (listing.minOrderQty !== null) {
    const min = quantityToMilli(listing.minOrderQty);
    const wholeRemainder = available > 0n && available < min && milli === available;
    if (milli < min && !wholeRemainder) {
      throw new ValidationError('Below the minimum order', { minOrderQty: milliToQuantity(min) }, 'QUANTITY_BELOW_MINIMUM');
    }
  }
  return milliToQuantity(milli);
}

/** One of the three settings values; absent → the default (middle) one. */
export function checkValidity(hours: number | undefined, settings: AppSettingsValues): number {
  const { choices, defaultHours } = validityChoices(settings);
  if (hours === undefined) return defaultHours;
  if (!choices.includes(hours)) throw new ValidationError('Choose one of the offered validities', { validityHours: choices }, 'VALIDATION_ERROR');
  return hours;
}

export function checkNote(note: string | null | undefined, max: number = DEAL_LIMITS.offerNoteMax): string | null {
  if (note === undefined || note === null) return null;
  const trimmed = note.trim();
  if (trimmed === '') return null;
  if ([...trimmed].length > max) throw new ValidationError(`Keep the note under ${max} characters`, { max }, 'VALIDATION_ERROR');
  return trimmed;
}

/**
 * An opening row (§7.2): `offer` at most the asking price (`400 PRICE_ABOVE_ASKING`), `buy_now` at the asking price
 * whatever the body says (the server sets it), `quote` any price above zero. Then quantity, validity and note.
 */
export function validateOfferInput(
  listing: ListingForOffer,
  input: OfferInput,
  opts: { kind: OfferKind; available: bigint; settings: AppSettingsValues },
): ResolvedOffer {
  let price: number;
  if (opts.kind === 'buy_now') {
    price = assertPrice(listing.pricePaise ?? undefined);
  } else {
    price = assertPrice(input.pricePerUnitPaise);
    if (opts.kind === 'offer' && listing.pricePaise !== null && price > listing.pricePaise) {
      throw new ValidationError('An offer can be at most the asking price', { askingPricePaise: listing.pricePaise }, 'PRICE_ABOVE_ASKING');
    }
  }
  const quantity = checkQuantity(listing, input.quantity, opts.available);
  return {
    pricePerUnitPaise: price,
    quantity,
    totalPaise: totalPaise(price, quantity),
    validityHours: checkValidity(input.validityHours, opts.settings),
    note: checkNote(input.note),
  };
}

/** The pieces of a row the actions depend on. */
export interface OfferActionRow {
  status: OfferStatus;
  turn: PartySide;
  senderSide: PartySide;
  needsReconfirm: boolean;
  round: number;
}

/**
 * What a reader may do with a row (§7.5); every rule about who may act is decided here so screens only display it.
 * A `viewer` gets nothing; an expired row (by the passed clock) nothing. The turn side accepts (or reconfirms a revived
 * seller row), counters while rounds are left and the chain takes counters, or rejects; the sender may withdraw a
 * pending row; the buyer business may withdraw a backup.
 */
export function offerActions(
  row: OfferActionRow,
  side: PartySide,
  memberRole: MemberRole,
  opts: { canCounter: boolean; expired: boolean },
): OfferAction[] {
  if (memberRole === 'viewer') return [];
  if (row.status === 'backup') return side === 'buyer' ? ['withdraw'] : [];
  if (row.status !== 'pending' || opts.expired) return [];
  const actions: OfferAction[] = [];
  if (side === row.turn) {
    actions.push(row.needsReconfirm ? 'reconfirm' : 'accept');
    if (opts.canCounter && row.round < MAX_COUNTER_ROUNDS) actions.push('counter');
    actions.push('reject');
  }
  if (side === row.senderSide) actions.push('withdraw');
  return actions;
}

// ─── Refusals shared by every action (§7.4–§7.6) ───

export function offerNotFound(): AppError {
  return new AppError('Offer not found', 404, 'OFFER_NOT_FOUND');
}

export function offerNotOpen(status: OfferStatus, reason?: string): ConflictError {
  return new ConflictError('This offer is no longer open', 'OFFER_NOT_OPEN', { status, ...(reason ? { reason } : {}) });
}

export function notYourTurn(): ConflictError {
  return new ConflictError('It is not your turn on this offer', 'NOT_YOUR_TURN');
}

export function offerExpired(): ConflictError {
  return new ConflictError('This offer has expired', 'OFFER_EXPIRED');
}
