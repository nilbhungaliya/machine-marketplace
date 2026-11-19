import {
  quantityToMilli,
  type ListingKind, type ListingReportReason, type ListingReportRequest, type OtherSideCard, type OtherSideResult,
  type PartSide, type PriceModel,
} from '@mpm/shared-types';
import type { ListingSheet } from '@/navigation/types';
import type { PendingContactAction } from './pending-action';
import { errorCode } from './api-error';
import { toAsciiDigits } from './digits';

// The listing page's decisions (F2 spec §8, §9; plan Task 26; F6 + F7 §7.1, §8.4, §15.2): which contact buttons a
// buyer sees, the Other side block, the report form's checks and the remembered "Check my machine" choice. Pure.

export type ContactAction = 'enquire' | 'make_offer' | 'buy' | 'ask_price';

/**
 * F6 + F7 §7.1: rentals → Enquire (no offers, R2); negotiable → Enquire + Make offer; fixed → Enquire + Buy at this
 * price; on request → Ask price; a listing without a price model → Enquire.
 */
export function contactActions(l: { kind: ListingKind; priceModel: PriceModel | null }): ContactAction[] {
  if (l.kind === 'machine_rental') return ['enquire'];
  if (l.priceModel === 'negotiable') return ['enquire', 'make_offer'];
  if (l.priceModel === 'fixed') return ['enquire', 'buy'];
  if (l.priceModel === 'on_request') return ['ask_price'];
  return ['enquire'];
}

/**
 * Which contact sheets the listing page mounts (F6 + F7 §7.1, §15.2): never on the owner's own listing; the enquiry
 * sheet (Enquire / Ask price) for every buyer, the offer sheet (Make offer / Buy) only where the price model has one.
 * Mounted beside the page's other sheets, outside the footer, so a guest's pending action can open them on arrival.
 */
export function contactSheets(l: { isOwner: boolean; kind: ListingKind; priceModel: PriceModel | null }):
  { enquire: boolean; offer: boolean } {
  if (l.isOwner) return { enquire: false, offer: false };
  const actions = contactActions(l);
  return {
    enquire: actions.includes('enquire') || actions.includes('ask_price'),
    offer: actions.includes('make_offer') || actions.includes('buy'),
  };
}

/** A footer button of the listing page: the action, or `open_chat` when the buyer already has a thread here. */
export type ContactButtonAction = ContactAction | 'open_chat';

export interface ContactButton {
  action: ContactButtonAction;
  /** Make offer / Buy with nothing available (all on hold in deals, §7.1). */
  disabled: boolean;
}

export interface ContactButtons {
  buttons: ContactButton[];
  /** "All on hold in deals": available is 0 (the listing is `reserved`). */
  allOnHold: boolean;
}

/** Whether a decimal-string quantity is zero ("0", "0.000"). */
const isZero = (q: string | null): boolean => q != null && /^0+(\.0+)?$/.test(q.trim());

/**
 * The listing page's contact buttons (§7.1, §15.2): none on the viewer's own listing; Enquire / Ask price become
 * "Open chat" when the buyer already has a thread on it (`myThreadId`), and an open negotiation keeps Make offer / Buy
 * out (it is answered in the chat); Make offer / Buy are disabled while nothing is available. Guests get the same
 * buttons (no thread yet); tapping asks them to sign in.
 */
export function contactButtons(l: {
  kind: ListingKind;
  priceModel: PriceModel | null;
  availableQuantity: string | null;
  isOwner: boolean;
  myThreadId: string | null;
  openNegotiation: unknown | null;
}): ContactButtons {
  if (l.isOwner) return { buttons: [], allOnHold: false };
  const allOnHold = isZero(l.availableQuantity);
  const base = contactActions(l);
  const buttons: ContactButton[] = [];
  for (const action of base) {
    if (action === 'enquire' || action === 'ask_price') {
      buttons.push({ action: l.myThreadId ? 'open_chat' : action, disabled: false });
      continue;
    }
    if (l.openNegotiation) {
      if (!buttons.some((b) => b.action === 'open_chat') && l.myThreadId) buttons.push({ action: 'open_chat', disabled: false });
      continue;
    }
    buttons.push({ action, disabled: allOnHold });
  }
  return { buttons, allOnHold };
}

/** The sheet a contact action opens (and the guest's pending action type, §15.2). */
export function sheetOf(action: ContactAction): ListingSheet {
  return action === 'make_offer' ? 'offer' : action;
}

/** Why a guest is asked to sign in for it (`auth.signInSheet.*.<reason>`): Enquire / Ask price → `enquire`, offers → `offer`. */
export function signInReasonOf(action: ContactAction): 'enquire' | 'offer' {
  return action === 'make_offer' || action === 'buy' ? 'offer' : 'enquire';
}

/** The guest's pending action for a contact tap: reopens the listing with this sheet after sign-in (never sends). */
export function pendingContactOf(action: ContactAction, listingId: string): PendingContactAction {
  return { type: sheetOf(action), listingId };
}

/**
 * What a listing page does with `route.params.openSheet` once the listing has loaded (§15.2): open that sheet when its
 * button is there and enabled; go to the chat when the buyer already has a thread for an Enquire / Ask price; else
 * nothing (own listing, all on hold, an offer already open).
 */
export function arrivalAction(sheet: ListingSheet | undefined, c: ContactButtons): { type: 'sheet'; sheet: ListingSheet } | { type: 'thread' } | null {
  if (!sheet) return null;
  const match = c.buttons.find((b) => b.action !== 'open_chat' && sheetOf(b.action) === sheet);
  if (match) return match.disabled ? null : { type: 'sheet', sheet };
  if ((sheet === 'enquire' || sheet === 'ask_price') && c.buttons.some((b) => b.action === 'open_chat')) return { type: 'thread' };
  return null;
}

/** "2 of 3 pcs available" when some is on hold; null when everything is available or the listing has no quantity. */
export function availabilityLine(l: { quantity: string | null; availableQuantity: string | null }):
  { kind: 'partial'; available: string; quantity: string } | { kind: 'none' } | null {
  if (l.quantity == null || l.availableQuantity == null) return null;
  if (isZero(l.availableQuantity)) return { kind: 'none' };
  if (quantityToMilli(l.availableQuantity) < quantityToMilli(l.quantity)) {
    return { kind: 'partial', available: l.availableQuantity, quantity: l.quantity };
  }
  return null;
}

/** A left or right part: it has an Other side (§9.1). Pairs and parts without a side don't. */
export function hasOtherSide(l: { kind: ListingKind; side: PartSide | null }): l is { kind: 'part'; side: 'left' | 'right' } {
  return l.kind === 'part' && (l.side === 'left' || l.side === 'right');
}

export interface OtherSideBlock {
  side: 'left' | 'right';
  /** The complementary side the buyer is after. */
  want: 'left' | 'right';
  wantBest: OtherSideCard | null;
  wantCount: number;
  pairBest: OtherSideCard | null;
  pairCount: number;
  /** The line under the options: the best match (better tier first, the exact side before a pair); null = none. */
  lead: OtherSideCard | null;
}

/** The listing page's Other side block (§8.1 item 5) from `GET …/other-side`; null for a listing without a left / right side. */
export function otherSideBlock(side: PartSide | null | undefined, result: OtherSideResult | null | undefined): OtherSideBlock | null {
  if (side !== 'left' && side !== 'right') return null;
  const want = side === 'left' ? 'right' : 'left';
  const wantBest = result?.best[want] ?? null;
  const pairBest = result?.best.pair ?? null;
  const lead = [wantBest, pairBest]
    .filter((c): c is OtherSideCard => c !== null)
    .reduce<OtherSideCard | null>((best, c) => (best === null || c.tier < best.tier ? c : best), null);
  return {
    side, want, wantBest, pairBest, lead,
    wantCount: result?.counts[want] ?? 0,
    pairCount: result?.counts.pair ?? 0,
  };
}

/** Report details limit (§8.4). */
export const REPORT_DETAILS_MAX = 500;

export type ReportProblem = 'reason' | 'detailsRequired' | 'detailsTooLong';

/** What stops a report from being sent: no reason, no details for Something else, details over 500. */
export function reportProblem(reason: ListingReportReason | null, details: string): ReportProblem | null {
  if (!reason) return 'reason';
  const text = details.trim();
  if (text.length > REPORT_DETAILS_MAX) return 'detailsTooLong';
  if (reason === 'something_else' && text === '') return 'detailsRequired';
  return null;
}

/** `POST …/reports` body: details trimmed, empty → null. */
export function reportBody(reason: ListingReportReason, details: string): ListingReportRequest {
  const text = details.trim();
  return { reason, details: text === '' ? null : text };
}

/** "Check my machine" (§8.3): the machine last checked, remembered on the device. */
export interface FitChoice {
  brandId: string;
  modelId: string | null;
  year: number | null;
}

export const FIT_CHOICE_STORAGE_KEY = 'listing.fitCheck.machine';

export function serializeFitChoice(c: FitChoice): string {
  return JSON.stringify({ brandId: c.brandId, modelId: c.modelId, year: c.year });
}

/** The stored choice, or null for anything that isn't one (no brand). Bad model / year values are dropped. */
export function parseFitChoice(raw: string | null | undefined): FitChoice | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.brandId !== 'string' || o.brandId === '') return null;
  return {
    brandId: o.brandId,
    modelId: typeof o.modelId === 'string' && o.modelId !== '' ? o.modelId : null,
    year: typeof o.year === 'number' && Number.isInteger(o.year) ? o.year : null,
  };
}

export const FIT_YEAR_MIN = 1950;

/** The optional year of the machine: empty → none; else a whole year 1950 … next year (as fitment rows, §4.3). */
export function parseFitYear(text: string, now: number = Date.now()): { ok: true; year: number | null } | { ok: false } {
  const clean = toAsciiDigits(text).trim();
  if (clean === '') return { ok: true, year: null };
  if (!/^\d{4}$/.test(clean)) return { ok: false };
  const year = Number(clean);
  const max = new Date(now).getUTCFullYear() + 1;
  return year >= FIT_YEAR_MIN && year <= max ? { ok: true, year } : { ok: false };
}

/**
 * A listing that answered `404 LISTING_NOT_FOUND` on its last fetch is gone for this viewer (removed, hidden, sold to
 * nobody), even while React Query still holds the old data: the page shows "not available".
 */
export function isListingGone(isError: boolean, error: unknown): boolean {
  return isError && errorCode(error) === 'LISTING_NOT_FOUND';
}
