import { PART_REQUEST_DROP_REASONS, type Language, type NotificationType } from '@mpm/shared-types';
import { maskContact } from '../../lib/mask-contact.js';
import { en } from './text/en.js';
import { gu } from './text/gu.js';
import { hi } from './text/hi.js';
import type { NotificationTexts, RenderedText, TextParams } from './text/types.js';

/**
 * Notification text (F6 + F7 spec §11.4; ported from textile `services/notifications/render.ts`): rendered from the
 * row's `type` and `params` in the reader's language, for `GET /notifications` and for each push. Rows store values,
 * never a finished sentence.
 *
 * **Params contract** (what `notify(tx, …)` callers put in `params`; ids and safe values only):
 * - `businessName` — the other business's trade name (the actor's side);
 * - `listingTitle` — the listing title (the deal's title snapshot for deal events);
 * - `pricePerUnitPaise` — a safe integer (or digit string);
 * - `quantity` (decimal string) and `unitLabel`;
 * - `dealRef` — the deal's number (500001…);
 * - `dueAt` — an ISO time (`review_waiting`; F8: `part_request_expiring` the expiry, `part_request_expired` the last
 *   renewable moment);
 * - F8 (spec §10.3): `requestTitle` (the request name, masked again here), `side` (`left` / `right` / `pair`, localised
 *   by the template), `distanceKm` (the match's stored **snapped** whole km), `city`, `reason` (a drop reason code).
 *   Never the request note, a reply message, the budget, a phone, a pincode or an address.
 * Unknown keys are ignored. Names and titles are masked here (`maskContact`) and the finished title and body masked
 * once more, so a number in a name or title never reaches a push or the list. Message text, notes and review text are
 * never params.
 */

const TEXTS: Record<Language, NotificationTexts> = { en, hi, gu };

const LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN', gu: 'gu-IN' };

/** A user-written value made safe: masked, whitespace tidied, cut to `max`. */
export function safeText(value: unknown, max = 120): string {
  if (typeof value !== 'string') return '';
  const clean = maskContact(value.replace(/\s+/g, ' ').trim());
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Indian grouping, paise only when there are any: `₹1,23,456` or `₹99.50`; '' for anything that isn't a whole amount. */
export function formatRupees(paise: unknown): string {
  const raw = typeof paise === 'number' && Number.isSafeInteger(paise) && paise >= 0 ? String(paise) : paise;
  if (typeof raw !== 'string' || !/^\d{1,20}$/.test(raw)) return '';
  const value = BigInt(raw);
  const rupees = (value / 100n).toString();
  const rest = value % 100n;
  const last3 = rupees.slice(-3);
  const head = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = head ? `${head},${last3}` : last3;
  return `₹${grouped}${rest === 0n ? '' : `.${rest.toString().padStart(2, '0')}`}`;
}

function quantityText(params: Record<string, unknown>): string {
  const q = params.quantity;
  const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  const qs = typeof q === 'number' && Number.isFinite(q) && q >= 0 ? String(q) : typeof q === 'string' && /^\d{1,14}(\.\d{1,3})?$/.test(q) ? trim(q) : '';
  if (!qs) return '';
  const unit = safeText(params.unitLabel, 20);
  return unit ? `${qs} ${unit}` : qs;
}

function dealRefText(v: unknown): string {
  const s = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : typeof v === 'string' && /^\d{1,12}$/.test(v) ? v : '';
  return s ? `#${s}` : '';
}

function dueOnText(v: unknown, language: Language): string {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return '';
  return new Date(v).toLocaleDateString(LOCALE[language], { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

const SIDES = new Set(['left', 'right', 'pair']);
const DROP_REASONS = new Set<string>(PART_REQUEST_DROP_REASONS);

/** A stored snapped distance (whole km, F8 §10.3) as digits; '' for anything else. */
function distanceText(v: unknown): string {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  return typeof v === 'string' && /^\d{1,5}$/.test(v) ? String(Number(v)) : '';
}

/** The stored params, made safe for a template. */
export function textParams(params: Record<string, unknown>, language: Language, count = 1): TextParams {
  return {
    businessName: safeText(params.businessName, 80),
    listingTitle: safeText(params.listingTitle, 100),
    price: formatRupees(params.pricePerUnitPaise),
    quantity: quantityText(params),
    dealRef: dealRefText(params.dealRef),
    dueOn: dueOnText(params.dueAt, language),
    duePassed: typeof params.dueAt === 'string' && !Number.isNaN(Date.parse(params.dueAt)) && Date.parse(params.dueAt) <= Date.now(),
    count: Number.isSafeInteger(count) && count > 1 ? count : 1,
    requestTitle: safeText(params.requestTitle, 100),
    side: typeof params.side === 'string' && SIDES.has(params.side) ? (params.side as TextParams['side']) : '',
    distanceKm: distanceText(params.distanceKm),
    city: safeText(params.city, 60),
    reason: typeof params.reason === 'string' && DROP_REASONS.has(params.reason) ? (params.reason as TextParams['reason']) : '',
  };
}

/**
 * `{ title, body }` for a row in `language` (English for an unknown one). `count` is a grouped row's `unread_count`
 * (chat §11.2; F8 replies and matches §10.2).
 */
export function renderNotification(
  type: NotificationType,
  params: Record<string, unknown>,
  language: Language,
  count = 1,
): RenderedText {
  const texts = TEXTS[language] ?? TEXTS.en;
  const template = texts[type] ?? en[type];
  const { title, body } = template(textParams(params ?? {}, TEXTS[language] ? language : 'en', count));
  // A last pass over the finished text, for anything a template might carry through.
  return { title: maskContact(title), body: maskContact(body) };
}
