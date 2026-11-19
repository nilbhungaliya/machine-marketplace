import type {
  DeliveryOption, Fitment, GstPriceMode, ListingCard, PartSide, PriceModel, RentalPeriod, RentalTerms, Specs,
  TemplateField,
} from '@mpm/shared-types';
import { RENTAL_PERIODS } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import { formatDate } from './format-date';
import { formatRupees } from './money';
import { formatQuantity } from './quantity';

// Listing text for cards, the listing page and My listings (F2 spec §8.1, §10, §15.4, §15.5). Copy comes from
// `listing.json` at call time. Master-data labels by key with the server's label as fallback (an admin-added key the
// app doesn't know); catalogue names (brands, models, categories) as the admin typed them.

type Labelled = { key: string; label: string };

const known = (key: string): boolean => i18n.exists(key);

/** A condition's label: `listing.condition.<key>`, else the server's label. */
export function conditionLabel(c: Labelled | null | undefined): string {
  if (!c) return '';
  const key = `listing.condition.${c.key}`;
  return known(key) ? i18n.t(key) : c.label;
}

/** A unit's name ("Pieces"): `listing.unit.<key>.label`, else the server's label. */
export function unitLabel(u: Labelled | null | undefined): string {
  if (!u) return '';
  const key = `listing.unit.${u.key}.label`;
  return known(key) ? i18n.t(key) : u.label;
}

/** The per-unit suffix of a price ("/pc"). */
export function unitPer(u: Labelled | null | undefined): string {
  if (!u) return '';
  const key = `listing.unit.${u.key}.per`;
  return known(key) ? i18n.t(key) : i18n.t('listing.unitFallback.per', { unit: u.label });
}

/** "14 pcs", "2.5 kg"; the server's label for an unknown unit ("3 Bundles"). */
export function quantityText(quantity: string | null | undefined, u: Labelled | null | undefined): string {
  if (quantity == null || quantity === '') return '';
  const qty = formatQuantity(quantity);
  const count = Number(quantity);
  if (!u) return qty;
  const key = `listing.unit.${u.key}.count`;
  return known(`${key}_other`) ? i18n.t(key, { count, qty }) : i18n.t('listing.unitFallback.count', { qty, unit: u.label });
}

/** "₹2,500 /day". */
export function rateText(rate: { period: RentalPeriod; paise: number } | null | undefined): string {
  if (!rate) return '';
  return `${formatRupees(rate.paise)} ${i18n.t(`listing.period.${rate.period}`)}`;
}

/** The headline price of a card: "₹420 /pc", "Price on request", or a rental's headline rate. */
export function priceText(card: Pick<ListingCard, 'kind' | 'priceModel' | 'pricePaise' | 'unit' | 'rate'>): string {
  if (card.kind === 'machine_rental') return rateText(card.rate);
  if (card.priceModel === 'on_request') return i18n.t('listing.price.onRequest');
  if (card.pricePaise == null) return '';
  const per = card.kind === 'part' ? unitPer(card.unit) : '';
  return per ? `${formatRupees(card.pricePaise)} ${per}` : formatRupees(card.pricePaise);
}

/** The note after a price: "Negotiable · GST extra"; empty for Price on request and rentals. */
export function priceNote(card: { kind: ListingCard['kind']; priceModel: PriceModel | null; gstMode: GstPriceMode | null }): string {
  if (card.kind === 'machine_rental' || card.priceModel === 'on_request' || !card.priceModel) return '';
  const parts = [i18n.t(`listing.price.model.${card.priceModel}`)];
  if (card.gstMode) parts.push(i18n.t(`listing.price.gst.${card.gstMode}`));
  return parts.join(' · ');
}

/** The listing page's price line (§8.1 item 3): "₹420 /pc · Negotiable · GST extra". */
export function priceLine(card: Pick<ListingCard, 'kind' | 'priceModel' | 'pricePaise' | 'unit' | 'rate' | 'gstMode'>): string {
  return [priceText(card), priceNote(card)].filter(Boolean).join(' · ');
}

/**
 * The listing page's headline price (§8.1 item 3): an amount, "Price on request", or nothing. A draft in Preview may
 * have no price model or no amount yet: it shows nothing rather than a wrong "Price on request". Rentals use their
 * rate cards instead (null).
 */
export function headlinePrice(l: { kind: ListingCard['kind']; priceModel: PriceModel | null; pricePaise: number | null }):
  { type: 'amount'; paise: number } | { type: 'on_request' } | null {
  if (l.kind === 'machine_rental' || !l.priceModel) return null;
  if (l.priceModel === 'on_request') return { type: 'on_request' };
  return l.pricePaise == null ? null : { type: 'amount', paise: l.pricePaise };
}

/** A machine's hours run: "12,000 hours" (Indian grouping). */
export function hoursRunText(hours: number): string {
  return i18n.t('listing.view.hoursRunValue', { count: hours, hours: formatQuantity(String(hours)) });
}

/** Year range of a fit row: "2012–2020", "2012 on", "up to 2020", or ''. */
export function yearRange(from: number | null, to: number | null): string {
  if (from != null && to != null) return from === to ? String(from) : `${from}–${to}`;
  if (from != null) return i18n.t('listing.fits.yearFrom', { from });
  if (to != null) return i18n.t('listing.fits.yearTo', { to });
  return '';
}

/** A fit chip (§5.2, §8.1): "Tsudakoma ZW 408 · 2012–2020", "Toyota · all models". */
export function fitLine(f: Pick<Fitment, 'brandName' | 'modelName' | 'modelOther' | 'yearFrom' | 'yearTo' | 'note'>): string {
  const model = f.modelName ?? f.modelOther;
  const machine = model ? `${f.brandName ?? ''} ${model}`.trim() : `${f.brandName ?? ''} · ${i18n.t('listing.fits.allModels')}`;
  return [machine, yearRange(f.yearFrom, f.yearTo), f.note ?? ''].filter(Boolean).join(' · ');
}

/**
 * "18 km away", "Under 2 km away"; '' when unknown. The API sends whole km of the snapped distance, at least 1, so 1
 * means "under 2 km" (F4 + F5 spec §6.2).
 */
export function distanceText(km: number | null | undefined): string {
  if (km == null) return '';
  return km <= 1 ? i18n.t('listing.distance.near') : i18n.t('listing.distance.km', { km: Math.round(km) });
}

/** Where a listing is: "Aji GIDC, Rajkot". */
export function placeText(card: Pick<ListingCard, 'industrialAreaName' | 'city'>): string {
  return [card.industrialAreaName, card.city].filter(Boolean).join(', ');
}

const DAY_MS = 86_400_000;

/** "Updated today", "Updated 3 days ago" (up to 30 days), then "Updated 12 Oct 2026". */
export function updatedAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  const days = Math.floor((now - at) / DAY_MS);
  if (days <= 0) return i18n.t('listing.time.updatedToday');
  if (days <= 30) return i18n.t('listing.time.updatedDaysAgo', { count: days });
  return i18n.t('listing.time.updatedOn', { date: formatDate(at) });
}

/** "Expires today", "Expires in 5 days", "Expired"; '' without a date. */
export function expiresText(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return i18n.t('listing.time.expired');
  const days = Math.floor(ms / DAY_MS);
  return days === 0 ? i18n.t('listing.time.expiresToday') : i18n.t('listing.time.expiresInDays', { count: days });
}

/** "Left side", "Pair (both sides)", "No side". */
export function sideLabel(side: PartSide | null | undefined): string {
  return side ? i18n.t(`listing.side.${side}`) : '';
}

/** The SideToken kind for a part's side (`none` for no side). */
export function sideTokenKind(side: PartSide | null | undefined): 'left' | 'right' | 'pair' | 'none' {
  return side === 'left' || side === 'right' || side === 'pair' ? side : 'none';
}

export function deliveryLabel(d: DeliveryOption): string {
  return i18n.t(`listing.delivery.${d}`);
}

export interface SpecRow {
  key: string;
  label: string;
  value: string;
}

/**
 * The Specifications block (§8.1 item 6): the template's fields in template order with their labels (catalogue text,
 * as the admin typed it), option labels, number units and dates; empty values left out. A value whose field isn't in
 * the template is skipped (a retired field the public template no longer serves).
 */
export function specRows(fields: readonly TemplateField[], specs: Specs | null | undefined): SpecRow[] {
  const rows: SpecRow[] = [];
  for (const f of fields) {
    const v = specs?.[f.key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    const option = (k: string) => f.options.find((o) => o.key === k)?.label ?? k;
    let value: string;
    if (f.type === 'single_select') value = option(String(v));
    else if (f.type === 'multi_select') value = (Array.isArray(v) ? v : [String(v)]).map(option).join(', ');
    else if (f.type === 'number') value = f.unit ? `${v} ${f.unit}` : String(v);
    else if (f.type === 'date') value = Number.isNaN(Date.parse(String(v))) ? String(v) : formatDate(Date.parse(String(v)));
    else value = String(v);
    rows.push({ key: f.key, label: f.label, value });
  }
  return rows;
}

/** The rate cards of a rental (§8.1 item 3, v2 `.rates`): every period that has a rate, in `RENTAL_PERIODS` order. */
export function rentalRateCards(r: RentalTerms): { period: RentalPeriod; label: string; amount: string }[] {
  const by: Record<RentalPeriod, number | null> = {
    hour: r.rateHourPaise, day: r.rateDayPaise, week: r.rateWeekPaise, month: r.rateMonthPaise,
  };
  return RENTAL_PERIODS.filter((p) => by[p] != null).map((p) => ({
    period: p, label: i18n.t(`listing.periodName.${p}`), amount: formatRupees(by[p]!),
  }));
}

/** The rental terms (§4.5) as label / value rows: operator, fuel, transport, minimum hire, overtime, deposit. */
export function rentalTermRows(r: RentalTerms): { key: string; label: string; value: string }[] {
  const rows: { key: string; label: string; value: string }[] = [];
  const t = (k: string, o?: Record<string, unknown>) => i18n.t(`listing.${k}`, o);
  if (r.operator) {
    const rate = r.operatorRateDayPaise != null && (r.operator === 'optional' || r.operator === 'mandatory')
      ? ` · ${t('view.operatorRate', { amount: formatRupees(r.operatorRateDayPaise) })}` : '';
    rows.push({ key: 'operator', label: t('view.operator'), value: `${t(`rental.operator.${r.operator}`)}${rate}` });
  }
  rows.push({ key: 'fuel', label: t('view.fuel'), value: t(`rental.fuel.${r.fuel}`) });
  if (r.transport) {
    const charge = r.transportChargePaise != null ? ` · ${t('view.transportCharge', { amount: formatRupees(r.transportChargePaise) })}` : '';
    rows.push({ key: 'transport', label: t('view.transport'), value: `${t(`rental.transport.${r.transport}`)}${charge}` });
  }
  if (r.minDuration != null && r.minDurationPeriod) {
    rows.push({ key: 'minimum', label: t('view.minimum'), value: t(`view.minDuration_${r.minDurationPeriod}`, { count: r.minDuration }) });
  }
  if (r.overtimeRateHourPaise != null) {
    rows.push({ key: 'overtime', label: t('view.overtime'), value: `${formatRupees(r.overtimeRateHourPaise)} ${t('period.hour')}` });
  }
  if (r.depositPaise != null) rows.push({ key: 'deposit', label: t('view.deposit'), value: formatRupees(r.depositPaise) });
  return rows;
}

/** "Available now", or "Available from 5 Dec 2026" while the date is ahead (a past date reads "Available now"). */
export function availabilityText(availableFrom: string | null, now: number = Date.now()): string {
  if (!availableFrom) return i18n.t('listing.view.availableNow');
  const at = Date.parse(`${availableFrom}T00:00:00+05:30`);
  if (Number.isNaN(at) || at <= now) return i18n.t('listing.view.availableNow');
  return i18n.t('listing.view.availableFrom', { date: formatDate(at) });
}

/**
 * The gallery's order (§8.1 item 1): photos by `sortOrder` (the first is the cover), then videos by `sortOrder`. The
 * listing page's pager and the full-screen viewer (`ListingMedia { index }`) both use it, so an index means the same item.
 */
export function galleryOrder<T extends { type: 'photo' | 'video'; sortOrder: number }>(media: readonly T[]): T[] {
  return [...media].sort((a, b) => (a.type === b.type ? a.sortOrder - b.sortOrder : a.type === 'photo' ? -1 : 1));
}

/** "#100234" (§4.8). */
export function refText(ref: number): string {
  return `#${ref}`;
}
