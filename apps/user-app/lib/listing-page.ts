import type {
  ListingKind, ListingReportReason, ListingReportRequest, OtherSideCard, OtherSideResult, PartSide, PriceModel,
} from '@mpm/shared-types';
import { toAsciiDigits } from './digits';

// The listing page's decisions (F2 spec §8, §9; plan Task 26): which contact buttons a buyer sees, the Other side
// block, the report form's checks and the remembered "Check my machine" choice. Pure.

export type ContactAction = 'enquire' | 'make_offer' | 'ask_price';

/** §8.2: fixed → Enquire; negotiable → Enquire + Make offer; on request → Ask price; rentals → Enquire. */
export function contactActions(l: { kind: ListingKind; priceModel: PriceModel | null }): ContactAction[] {
  if (l.kind === 'machine_rental') return ['enquire'];
  if (l.priceModel === 'negotiable') return ['enquire', 'make_offer'];
  if (l.priceModel === 'on_request') return ['ask_price'];
  return ['enquire'];
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
