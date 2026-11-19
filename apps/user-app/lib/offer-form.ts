import {
  DEAL_LIMITS, MAX_COUNTER_ROUNDS, milliToQuantity, percentBelowAsking, quantityToMilli, totalPaise,
  type GstPriceMode, type ListingDetail, type OfferKind, type OfferView, type OffersOptions,
} from '@mpm/shared-types';
import { groupIndian, parseRupees, rupeesInput } from './money';
import { parseQuantity } from './quantity';

// The offer sheet's rules (F6 + F7 spec §7.1–§7.4, §15.1; textile app `lib/offer-form.ts` without payment terms,
// delivery or samples). Money stays integer paise (totals as decimal strings, never floats); quantities are decimal
// strings compared in thousandths with shared-types' `quantityToMilli`. The server decides: these rules only stop a
// request it would refuse, and show the same range (`counterBounds`) and totals (`totalPaise`) it uses. Pure.

/** The sheet's four modes (§15.1): a buyer's offer, Buy at this price, a counter, the seller's quote. */
export type OfferMode = 'offer' | 'buy' | 'counter' | 'quote';

/** Largest price per unit the API takes (`int4`, as listing prices, P4). */
export const OFFER_PRICE_MAX_PAISE = 2_147_483_647;

export interface OfferFormValues {
  /** Rupees as typed (Hindi / Gujarati digits allowed). Ignored in `buy` mode. */
  price: string;
  /** Quantity as typed. */
  quantity: string;
  /** One of the server's choices (`GET /offers/options`); null until they arrive, and nothing is sent without it. */
  validityHours: number | null;
  note: string;
}

/** What the rules need to know besides the values. */
export interface OfferFormContext {
  mode: OfferMode;
  /** The asking price (listing price for offer / buy, the chain's snapshot for a counter); null on request. */
  askingPaise: number | null;
  unitDecimals: number;
  minOrderQty: string | null;
  /** `quantity − held` now; null when unknown (the server still checks). */
  available: string | null;
  /** Counter only: the server's range for the turn side (`OfferView.bounds`, from `counterBounds`). */
  bounds?: { minPaise: number; maxPaise: number } | null;
  /** Counter only: the counter-er's own latest price and quantity, when known (`ownLatestFor`). */
  ownLatest?: { pricePaise: number; quantity: string } | null;
}

export type OfferPriceError = 'priceRequired' | 'priceInvalid' | 'priceAboveAsking' | 'counterOutOfBounds' | 'counterUnchanged';
export type OfferQuantityError =
  | 'quantityRequired' | 'quantityInvalid' | 'quantityDecimals' | 'quantityBelowMinimum' | 'quantityNotAvailable';

export interface OfferFormErrors {
  price?: OfferPriceError;
  quantity?: OfferQuantityError;
  note?: 'noteTooLong';
}

/** Typed rupees → paise above zero and within `int4`, else null. */
export function offerPricePaise(text: string): number | null {
  const paise = parseRupees(text);
  if (paise == null || paise <= 0 || paise > OFFER_PRICE_MAX_PAISE) return null;
  return paise;
}

/** The price the offer carries: the asking price in `buy` mode (the server sets it), else the typed one. */
export function effectivePricePaise(values: Pick<OfferFormValues, 'price'>, ctx: Pick<OfferFormContext, 'mode' | 'askingPaise'>): number | null {
  if (ctx.mode === 'buy') return ctx.askingPaise;
  return offerPricePaise(values.price);
}

/** Typed quantity → the API's decimal string, or the reason it can't be one (unit decimals included). */
function readQuantity(text: string, decimals: number): { ok: true; value: string } | { ok: false; error: OfferQuantityError } {
  const r = parseQuantity(text, decimals);
  if (r.ok) return r;
  if (r.problem === 'empty') return { ok: false, error: 'quantityRequired' };
  if (r.problem === 'decimals') return { ok: false, error: 'quantityDecimals' };
  return { ok: false, error: 'quantityInvalid' };
}

/** Whether `0 < available < min` and `quantity` is exactly the whole remainder (§7.2, review change 3). */
export function isWholeRemainder(quantity: string, available: string | null, minOrderQty: string | null): boolean {
  if (available == null || minOrderQty == null) return false;
  const a = quantityToMilli(available);
  return a > 0n && a < quantityToMilli(minOrderQty) && quantityToMilli(quantity) === a;
}

/**
 * Field errors for the sheet (§7.2, §7.4): price required and above zero; an `offer` at most the asking price; a
 * counter inside the range and not unchanged (same price and quantity as one's own latest); quantity within the unit's
 * decimals, at least the minimum order (or exactly the whole remainder) and at most what is available; note ≤ 500.
 * `buy` locks the price, so a typed price is never checked.
 */
export function validateOfferForm(values: OfferFormValues, ctx: OfferFormContext): OfferFormErrors {
  const errors: OfferFormErrors = {};

  let price: number | null = null;
  if (ctx.mode !== 'buy') {
    if (values.price.trim() === '') errors.price = 'priceRequired';
    else {
      price = offerPricePaise(values.price);
      if (price == null) errors.price = 'priceInvalid';
      else if (ctx.mode === 'offer' && ctx.askingPaise != null && price > ctx.askingPaise) errors.price = 'priceAboveAsking';
      else if (ctx.mode === 'counter' && ctx.bounds && (price < ctx.bounds.minPaise || price > ctx.bounds.maxPaise)) {
        errors.price = 'counterOutOfBounds';
      }
    }
  }

  const q = readQuantity(values.quantity, ctx.unitDecimals);
  if (!q.ok) errors.quantity = q.error;
  else {
    const milli = quantityToMilli(q.value);
    if (ctx.available != null && milli > quantityToMilli(ctx.available)) errors.quantity = 'quantityNotAvailable';
    else if (
      ctx.minOrderQty != null
      && milli < quantityToMilli(ctx.minOrderQty)
      && !isWholeRemainder(q.value, ctx.available, ctx.minOrderQty)
    ) {
      errors.quantity = 'quantityBelowMinimum';
    }
    if (
      ctx.mode === 'counter' && !errors.price && price != null && ctx.ownLatest
      && price === ctx.ownLatest.pricePaise && milli === quantityToMilli(ctx.ownLatest.quantity)
    ) {
      errors.price = 'counterUnchanged';
    }
  }

  if ([...values.note.trim()].length > DEAL_LIMITS.offerNoteMax) errors.note = 'noteTooLong';
  return errors;
}

export const hasOfferErrors = (e: OfferFormErrors): boolean => !!(e.price || e.quantity || e.note);

/** `+ GST` / `incl. GST` after a total (§7.2), or nothing without a GST mode. */
export function gstLabelKey(gstMode: GstPriceMode | null): string | null {
  if (gstMode === 'extra') return 'offers.gst.extra';
  if (gstMode === 'included') return 'offers.gst.included';
  return null;
}

export interface OfferTotals {
  /** Paise as a decimal string (P4), null until price and quantity are readable. */
  totalPaise: string | null;
  /** Whole % below asking (rounded down, P13), only on negotiable chains and only when below. */
  percentBelow: number | null;
  gstLabelKey: string | null;
}

/**
 * The sheet's live total: `totalPaise(price, quantity)` from shared-types (half up from thousandths, as the server),
 * the % below asking on negotiable chains, and the GST label.
 */
export function offerTotals(
  input: { pricePaise: number | null; quantity: string; unitDecimals: number },
  opts: { gstMode: GstPriceMode | null; askingPaise: number | null; negotiable: boolean },
): OfferTotals {
  const q = parseQuantity(input.quantity, Math.min(input.unitDecimals, 3));
  const total = input.pricePaise != null && q.ok ? totalPaise(input.pricePaise, q.value).toString() : null;
  const percentBelow = opts.negotiable && input.pricePaise != null && opts.askingPaise != null
    ? percentBelowAsking(input.pricePaise, opts.askingPaise)
    : null;
  return { totalPaise: total, percentBelow, gstLabelKey: gstLabelKey(opts.gstMode) };
}

/** Whether a chain is negotiable (% below asking shows): a buyer's offer, or a counter in an `offer` chain. */
export function isNegotiableChain(mode: OfferMode, offer?: Pick<OfferView, 'kind' | 'askingPricePaise'> | null): boolean {
  if (mode === 'offer') return true;
  if (mode === 'counter') return offer?.kind === 'offer' && offer.askingPricePaise != null;
  return false;
}

/**
 * The default quantity of a new offer (§7.2): the minimum order, else 1; never more than is available, and the whole
 * remainder when less than the minimum is left.
 */
export function defaultOfferQuantity(minOrderQty: string | null, available: string | null): string {
  const want = minOrderQty != null ? quantityToMilli(minOrderQty) : 1000n;
  if (available == null) return milliToQuantity(want);
  const a = quantityToMilli(available);
  if (a <= 0n) return milliToQuantity(want);
  return milliToQuantity(a < want ? a : want);
}

/** The sheet's starting values per mode (§7.2): validity is the settings' default (null until the options arrive). */
export function offerFormState(input: {
  mode: OfferMode;
  listing?: Pick<ListingDetail, 'minOrderQty' | 'availableQuantity'> | null;
  offer?: Pick<OfferView, 'quantity'> | null;
  options?: Pick<OffersOptions, 'defaultValidityHours'> | null;
  /** Quote: the enquiry's quantity, when known. */
  quoteQuantity?: string | null;
  /** Quote / counter: what the strip says is available and the minimum, for the default. */
  strip?: { minOrderQty: string | null; availableQuantity: string | null } | null;
}): OfferFormValues {
  const validityHours = input.options?.defaultValidityHours ?? null;
  if (input.mode === 'counter') {
    return { price: '', quantity: input.offer?.quantity ?? '', validityHours, note: '' };
  }
  if (input.mode === 'quote') {
    const strip = input.strip ?? null;
    const quantity = input.quoteQuantity ?? defaultOfferQuantity(strip?.minOrderQty ?? null, strip?.availableQuantity ?? null);
    return { price: '', quantity, validityHours, note: '' };
  }
  const l = input.listing ?? null;
  return {
    price: '',
    quantity: defaultOfferQuantity(l?.minOrderQty ?? null, l?.availableQuantity ?? null),
    validityHours,
    note: '',
  };
}

/**
 * The options arrived after the sheet opened: only the validity takes the server's default, and only when the user
 * hasn't picked one the server offers. Price, quantity and note stay as typed. The same object when nothing changes.
 */
export function withOfferOptions(values: OfferFormValues, options: Pick<OffersOptions, 'validityHours' | 'defaultValidityHours'>):
  OfferFormValues {
  if (values.validityHours != null && options.validityHours.includes(values.validityHours)) return values;
  return { ...values, validityHours: options.defaultValidityHours };
}

/** Prefills a typed price (e.g. "Use asking price") as the input shows it. */
export const priceInputText = (paise: number | null | undefined): string => rupeesInput(paise ?? null);

/**
 * The counter-er's own latest terms when the view tells them for certain: the seller answering the buyer's opening
 * offer has only the asking snapshot (and the server compares with the answered row's quantity). Later rounds are
 * left to the server (`400 COUNTER_UNCHANGED`).
 */
export function ownLatestFor(offer: Pick<OfferView, 'round' | 'senderSide' | 'kind' | 'askingPricePaise' | 'quantity'>):
  { pricePaise: number; quantity: string } | null {
  if (offer.round === 0 && offer.senderSide === 'buyer' && offer.kind === 'offer' && offer.askingPricePaise != null) {
    return { pricePaise: offer.askingPricePaise, quantity: offer.quantity };
  }
  return null;
}

/** The range hint of a counter ("Between ₹34,000 and ₹38,500"): exactly the server's `bounds`; null when empty. */
export function boundsHint(bounds: { minPaise: number; maxPaise: number } | null | undefined): { minPaise: number; maxPaise: number } | null {
  if (!bounds || bounds.minPaise > bounds.maxPaise) return null;
  return { minPaise: bounds.minPaise, maxPaise: bounds.maxPaise };
}

/** "Round n of 5" on a counter row; null on an opening row. */
export function roundLabel(offer: Pick<OfferView, 'round'>): { key: string; values: { round: number; max: number } } | null {
  if (offer.round < 1) return null;
  return { key: 'offers.card.round', values: { round: offer.round, max: MAX_COUNTER_ROUNDS } };
}

/** After the 5th counter only accept or reject remain (§7.4): the card says so on an open row. */
export function counterLimitReached(offer: Pick<OfferView, 'status' | 'roundsLeft' | 'kind'>): boolean {
  return offer.status === 'pending' && offer.roundsLeft <= 0 && offer.kind !== 'buy_now';
}

/** `POST /listings/:id/offers` body. */
export interface SendOfferBody {
  kind: Extract<OfferKind, 'offer' | 'buy_now'>;
  pricePerUnitPaise?: number;
  quantity: string;
  validityHours: number;
  note?: string;
}

/** `POST /offers/:id/counter` and `POST /threads/:id/quote` body. */
export interface OfferTermsBody {
  pricePerUnitPaise: number;
  quantity: string;
  validityHours: number;
  note?: string;
}

/**
 * The request body for valid values (call after `validateOfferForm` found nothing); null without a validity from the
 * server's options, so a fallback the server may refuse is never sent.
 */
export function offerRequestBody(values: OfferFormValues, ctx: Pick<OfferFormContext, 'mode' | 'unitDecimals' | 'askingPaise'>):
  SendOfferBody | OfferTermsBody | null {
  if (values.validityHours == null) return null;
  const q = parseQuantity(values.quantity, ctx.unitDecimals);
  const quantity = q.ok ? q.value : values.quantity.trim();
  const note = values.note.trim();
  const tail = { quantity, validityHours: values.validityHours, ...(note ? { note } : {}) };
  if (ctx.mode === 'buy') return { kind: 'buy_now', ...tail };
  const pricePerUnitPaise = offerPricePaise(values.price) ?? 0;
  if (ctx.mode === 'offer') return { kind: 'offer', pricePerUnitPaise, ...tail };
  return { pricePerUnitPaise, ...tail };
}

/** Paise as a decimal string (P4) → `₹1,23,456` / `₹1,23,456.50`, in BigInt so no total ever passes through a float. */
export function formatPaiseText(paise: string | null | undefined): string {
  if (paise == null || !/^-?\d+$/.test(paise)) return '';
  const neg = paise.startsWith('-');
  const abs = BigInt(neg ? paise.slice(1) : paise);
  const rupees = abs / 100n;
  const rest = abs % 100n;
  return `${neg ? '-' : ''}₹${groupIndian(rupees.toString())}${rest ? `.${rest.toString().padStart(2, '0')}` : ''}`;
}

/** A validity choice as words: whole days from 3 days up ("7 days"), else hours ("48 hours"). */
export function validityParts(hours: number): { unit: 'days' | 'hours'; count: number } {
  return hours >= 72 && hours % 24 === 0 ? { unit: 'days', count: hours / 24 } : { unit: 'hours', count: hours };
}

export type OfferChipTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'new';

/** How an offer card reads for its reader (§7.5, §15.1): title, status chip and the callout under the terms. */
export interface OfferCardState {
  titleKey: string;
  chip: { key: string; values?: Record<string, number>; tone: OfferChipTone };
  notice: { key: string; tone: 'info' | 'warning' | 'danger' } | null;
}

const HOUR_MS = 3_600_000;

export function offerCardState(
  offer: Pick<OfferView, 'status' | 'isMine' | 'kind' | 'round' | 'turn' | 'senderSide' | 'needsReconfirm' | 'expiresAt' |
    'closeReason' | 'roundsLeft'>,
  readerSide: 'buyer' | 'seller',
  now: number,
): OfferCardState {
  const who = offer.isMine ? 'mine' : 'theirs';
  const what = offer.kind === 'quote' && offer.round === 0 ? 'quote'
    : offer.kind === 'buy_now' ? 'buy'
      : offer.round > 0 ? 'counter' : 'offer';
  const titleKey = `offers.card.title.${who}.${what}`;

  let chip: OfferCardState['chip'];
  let notice: OfferCardState['notice'] = null;
  switch (offer.status) {
    case 'pending': {
      if (offer.needsReconfirm) {
        chip = readerSide === 'seller'
          ? { key: 'offers.card.status.reconfirmSeller', tone: 'new' }
          : { key: 'offers.card.status.reconfirmBuyer', tone: 'warn' };
        notice = { key: readerSide === 'seller' ? 'offers.card.reconfirmSeller' : 'offers.card.reconfirmBuyer', tone: 'info' };
        break;
      }
      if (offer.turn === readerSide) {
        const left = offer.expiresAt ? Date.parse(offer.expiresAt) - now : null;
        chip = left != null && left > 0
          ? { key: 'offers.card.status.respondIn', values: { hours: Math.max(1, Math.ceil(left / HOUR_MS)) }, tone: 'new' }
          : { key: 'offers.card.status.yourTurn', tone: 'new' };
      } else {
        chip = { key: 'offers.card.status.waiting', tone: 'warn' };
      }
      if (counterLimitReached(offer)) notice = { key: 'offers.card.limit', tone: 'info' };
      break;
    }
    case 'backup':
      chip = { key: 'offers.card.status.backup', tone: 'warn' };
      notice = { key: readerSide === 'buyer' ? 'offers.card.backupBuyer' : 'offers.card.backupSeller', tone: 'warning' };
      break;
    case 'accepted':
      chip = { key: 'offers.card.status.accepted', tone: 'ok' };
      break;
    case 'countered':
      chip = { key: 'offers.card.status.countered', tone: 'neutral' };
      break;
    case 'rejected':
      chip = { key: 'offers.card.status.rejected', tone: 'danger' };
      break;
    case 'withdrawn':
      chip = { key: 'offers.card.status.withdrawn', tone: 'neutral' };
      break;
    case 'expired':
      chip = { key: 'offers.card.status.expired', tone: 'neutral' };
      break;
    case 'closed':
    default:
      chip = { key: 'offers.card.status.closed', tone: 'neutral' };
      notice = offer.closeReason ? { key: `offers.card.closedReason.${offer.closeReason}`, tone: 'info' } : null;
      break;
  }
  return { titleKey, chip, notice };
}
