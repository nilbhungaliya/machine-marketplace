import {
  LISTING_DESCRIPTION_MAX, LISTING_TITLE_MAX, LISTING_TITLE_MIN, PART_NUMBER_MAX, sanityFlags,
  type DeliveryOption, type Fitment, type GstPriceMode, type ListingFlag, type ListingKind, type ListingOwnerView,
  type ListingPatch, type PriceModel, type RentalFuel, type RentalOperator, type RentalPeriod, type RentalTerms,
  type RentalTransport, type Specs, type Unit,
} from '@mpm/shared-types';
import { toAsciiDigits } from './digits';
import { parseRupees, rupeesInput } from './money';
import { PINCODE_REGEX } from './onboarding-step';
import { parseMachineCount, parseQuantity } from './quantity';
import { isSpecDate } from './spec-form';

// The sell wizard's step forms (F2 spec §4, §5.2; plan Tasks 23–24): form values (raw text, Hindi / Gujarati digits
// kept) ↔ the step's `PATCH /listings/:id` body, and the checks Next runs before saving. Pure. Errors are i18n keys with
// params; the screen translates them (`translateErrors`). The API stays the authority: these mirror its limits so the
// seller sees a problem before the round trip.

export type FieldError = { key: string; params?: Record<string, unknown> };
export type FormErrors<K extends string = string> = Partial<Record<K, FieldError>>;
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** `{ title: { key, params } }` → `{ title: 'Enter 3 to 100 characters.' }` (Formik's error shape). */
export function translateErrors(errors: Record<string, FieldError | undefined>, t: Translate): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, e] of Object.entries(errors)) if (e) out[k] = t(e.key, e.params);
  return out;
}

const trimOrNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** Typed whole number (any digits) → number, null when empty, NaN when not a whole number. */
export function parseWhole(text: string): number | null {
  const clean = toAsciiDigits(text).replace(/[,\s]/g, '');
  if (clean === '') return null;
  return /^\d{1,10}$/.test(clean) ? Number(clean) : Number.NaN;
}

/** An optional whole number in `min … max`: the error, or null when empty or fine. */
function wholeError(text: string, min: number, max: number): FieldError | null {
  const n = parseWhole(text);
  if (n === null) return null;
  return Number.isNaN(n) || n < min || n > max ? { key: 'sell.validation.wholeRange', params: { min, max } } : null;
}

const textMax = (text: string, max: number): FieldError | null =>
  text.trim().length > max ? { key: 'sell.validation.textMax', params: { max } } : null;

const titleError = (title: string): FieldError | null => {
  const n = title.trim().length;
  return n < LISTING_TITLE_MIN || n > LISTING_TITLE_MAX
    ? { key: 'sell.validation.titleLength', params: { min: LISTING_TITLE_MIN, max: LISTING_TITLE_MAX } }
    : null;
};

function collect<K extends string>(entries: [K, FieldError | null][]): FormErrors<K> {
  const out: FormErrors<K> = {};
  for (const [k, e] of entries) if (e) out[k] = e;
  return out;
}

const PICK_ONE: FieldError = { key: 'sell.validation.pickOne' };
const REQUIRED: FieldError = { key: 'sell.validation.required' };

// ─── Part details (§4.2, §4.3) ───

export interface PartDetailsValues {
  title: string;
  partNumber: string;
  description: string;
}

const PART_NUMBER_RE = /^[A-Za-z0-9 ./-]*$/;

export function partDetailsInitial(l: ListingOwnerView, prefillTitle: string): PartDetailsValues {
  return { title: l.title || prefillTitle, partNumber: l.partNumber ?? '', description: l.description ?? '' };
}

export function validatePartDetails(v: PartDetailsValues): FormErrors<keyof PartDetailsValues> {
  const pn = v.partNumber.trim();
  return collect<keyof PartDetailsValues>([
    ['title', titleError(v.title)],
    ['partNumber', pn.length > PART_NUMBER_MAX || !PART_NUMBER_RE.test(pn) ? { key: 'sell.details.partNumberInvalid', params: { max: PART_NUMBER_MAX } } : null],
    ['description', textMax(v.description, LISTING_DESCRIPTION_MAX)],
  ]);
}

export function partDetailsPatch(v: PartDetailsValues, specs: Specs): ListingPatch {
  return { title: v.title.trim(), partNumber: trimOrNull(v.partNumber), description: trimOrNull(v.description), specs };
}

// ─── Quantity and condition (§4.2) ───

export interface QuantityValues {
  quantity: string;
  unitId: string;
  conditionId: string;
  conditionNote: string;
}

export const CONDITION_NOTE_MAX = 300;

export function quantityInitial(l: ListingOwnerView): QuantityValues {
  return { quantity: l.quantity ?? '', unitId: l.unitId ?? '', conditionId: l.conditionId ?? '', conditionNote: l.conditionNote ?? '' };
}

/** Parts: the unit's decimals; machines: whole numbers 1–1000 and the server's unit (none asked). */
export function validateQuantity(v: QuantityValues, ctx: { kind: ListingKind; decimals: number }): FormErrors<keyof QuantityValues> {
  const q = ctx.kind === 'part' ? parseQuantity(v.quantity, ctx.decimals) : parseMachineCount(v.quantity);
  return collect<keyof QuantityValues>([
    ['quantity', q.ok ? null : { key: `sell.quantity.${q.problem}` }],
    ['unitId', ctx.kind === 'part' && !v.unitId ? PICK_ONE : null],
    ['conditionId', v.conditionId ? null : PICK_ONE],
    ['conditionNote', textMax(v.conditionNote, CONDITION_NOTE_MAX)],
  ]);
}

export function quantityPatch(v: QuantityValues, kind: ListingKind): ListingPatch {
  const q = kind === 'part' ? parseQuantity(v.quantity, 3) : parseMachineCount(v.quantity);
  return {
    ...(q.ok ? { quantity: q.value } : {}),
    ...(kind === 'part' && v.unitId ? { unitId: v.unitId } : {}),
    ...(v.conditionId ? { conditionId: v.conditionId } : {}),
    conditionNote: trimOrNull(v.conditionNote),
  };
}

// ─── Machine (§4.4); rentals also carry their machine count here ───

export interface MachineValues {
  title: string;
  description: string;
  brandId: string | null;
  brandIsOther: boolean;
  brandOther: string;
  modelId: string | null;
  modelIsOther: boolean;
  modelOther: string;
  year: string;
  hoursRun: string;
  serialNumber: string;
  underPower: boolean;
  inspection: boolean;
  reasonForSale: string;
  /** Rentals only: the number of machines (`quantity`). */
  count: string;
}

export const MACHINE_OTHER_MAX = 60;
export const SERIAL_MAX = 60;
export const REASON_FOR_SALE_MAX = 200;
export const HOURS_RUN_MAX = 1_000_000;
export const YEAR_MIN = 1950;

export function machineInitial(l: ListingOwnerView): MachineValues {
  const m = l.machine;
  return {
    title: l.title ?? '',
    description: l.description ?? '',
    brandId: m?.brandId ?? null,
    brandIsOther: !m?.brandId && !!m?.brandOther,
    brandOther: m?.brandOther ?? '',
    modelId: m?.modelId ?? null,
    modelIsOther: !m?.modelId && !!m?.modelOther,
    modelOther: m?.modelOther ?? '',
    year: m?.year != null ? String(m.year) : '',
    hoursRun: m?.hoursRun != null ? String(m.hoursRun) : '',
    serialNumber: m?.serialNumber ?? '',
    underPower: m?.underPower ?? false,
    inspection: m?.inspectionByAppointment ?? false,
    reasonForSale: m?.reasonForSale ?? '',
    count: l.quantity ?? (l.kind === 'machine_rental' ? '1' : ''),
  };
}

const otherLength = (text: string, min: number): FieldError | null => {
  const n = text.trim().length;
  return n < min || n > MACHINE_OTHER_MAX ? { key: 'sell.machine.otherLength', params: { min, max: MACHINE_OTHER_MAX } } : null;
};

export function validateMachine(v: MachineValues, ctx: { kind: ListingKind; thisYear: number }): FormErrors<keyof MachineValues> {
  const count = ctx.kind === 'machine_rental' ? parseMachineCount(v.count) : null;
  return collect<keyof MachineValues>([
    ['title', titleError(v.title)],
    ['description', textMax(v.description, LISTING_DESCRIPTION_MAX)],
    ['brandId', !v.brandIsOther && !v.brandId ? { key: 'sell.machine.makeRequired' } : null],
    ['brandOther', v.brandIsOther ? otherLength(v.brandOther, 2) : null],
    ['modelOther', v.modelIsOther ? otherLength(v.modelOther, 1) : null],
    ['year', wholeError(v.year, YEAR_MIN, ctx.thisYear)],
    ['hoursRun', wholeError(v.hoursRun, 0, HOURS_RUN_MAX)],
    ['serialNumber', textMax(v.serialNumber, SERIAL_MAX)],
    ['reasonForSale', ctx.kind === 'machine' ? textMax(v.reasonForSale, REASON_FOR_SALE_MAX) : null],
    ['count', count && !count.ok ? { key: `sell.quantity.${count.problem}` } : null],
  ]);
}

const wholeOrNull = (text: string): number | null => {
  const n = parseWhole(text);
  return n === null || Number.isNaN(n) ? null : n;
};

/** The machine step's PATCH: catalogue id or Other text (never both), `reasonForSale` only for a sale, count for a rental. */
export function machinePatch(v: MachineValues, kind: ListingKind, specs: Specs): ListingPatch {
  const count = kind === 'machine_rental' ? parseMachineCount(v.count) : null;
  return {
    title: v.title.trim(),
    description: trimOrNull(v.description),
    specs,
    ...(count?.ok ? { quantity: count.value } : {}),
    machine: {
      brandId: v.brandIsOther ? null : v.brandId,
      brandOther: v.brandIsOther ? trimOrNull(v.brandOther) : null,
      modelId: v.modelIsOther ? null : v.modelId,
      modelOther: v.modelIsOther ? trimOrNull(v.modelOther) : null,
      year: wholeOrNull(v.year),
      hoursRun: wholeOrNull(v.hoursRun),
      serialNumber: trimOrNull(v.serialNumber),
      underPower: v.underPower,
      inspectionByAppointment: v.inspection,
      ...(kind === 'machine' ? { reasonForSale: trimOrNull(v.reasonForSale) } : {}),
    },
  };
}

// ─── Fit rows (§4.3, R37) ───

export interface FitRowValues {
  brandId: string | null;
  /** `all`: no model (all models of the brand) · `catalogue`: `modelId` · `other`: typed text. */
  modelMode: 'all' | 'catalogue' | 'other';
  modelId: string | null;
  modelOther: string;
  yearFrom: string;
  yearTo: string;
  note: string;
}

export const FIT_NOTE_MAX = 80;

export function validateFitRow(v: FitRowValues, thisYear: number): FormErrors<keyof FitRowValues> {
  const from = wholeOrNull(v.yearFrom);
  const to = wholeOrNull(v.yearTo);
  const fromErr = wholeError(v.yearFrom, YEAR_MIN, thisYear + 1);
  const toErr = wholeError(v.yearTo, YEAR_MIN, thisYear + 1);
  return collect<keyof FitRowValues>([
    ['brandId', v.brandId ? null : PICK_ONE],
    ['modelId', v.modelMode === 'catalogue' && !v.modelId ? PICK_ONE : null],
    ['modelOther', v.modelMode === 'other' ? otherLength(v.modelOther, 1) : null],
    ['yearFrom', fromErr],
    ['yearTo', toErr ?? (!fromErr && from != null && to != null && from > to ? { key: 'sell.fit.yearOrder' } : null)],
    ['note', textMax(v.note, FIT_NOTE_MAX)],
  ]);
}

export type FitmentInput = Pick<Fitment, 'brandId' | 'modelId' | 'modelOther' | 'yearFrom' | 'yearTo' | 'note'>;

export function fitRowPatch(v: FitRowValues): FitmentInput {
  return {
    brandId: v.brandId ?? '',
    modelId: v.modelMode === 'catalogue' ? v.modelId : null,
    modelOther: v.modelMode === 'other' ? trimOrNull(v.modelOther) : null,
    yearFrom: wholeOrNull(v.yearFrom),
    yearTo: wholeOrNull(v.yearTo),
    note: trimOrNull(v.note),
  };
}

// ─── Price (§4.6) ───

export interface PriceValues {
  priceModel: PriceModel | null;
  price: string;
  gstMode: GstPriceMode | null;
  minOrder: string;
}

export const PRICE_MIN_PAISE = 100;
export const PRICE_MAX_PAISE = 10_000_000_000;

export function priceInitial(l: ListingOwnerView): PriceValues {
  return { priceModel: l.priceModel, price: rupeesInput(l.pricePaise), gstMode: l.gstMode, minOrder: l.minOrderQty ?? '' };
}

/** A typed amount in a paise range: the error, or null when fine (`optional`: empty passes). */
function amountError(text: string, min: number, max: number, optional: boolean): FieldError | null {
  if (text.trim() === '') return optional ? null : REQUIRED;
  const p = parseRupees(text);
  if (p === null) return { key: 'sell.price.invalid' };
  return p < min || p > max ? { key: 'sell.price.range' } : null;
}

export function validatePrice(
  v: PriceValues, ctx: { kind: ListingKind; decimals: number; quantity: string | null },
): FormErrors<keyof PriceValues> {
  const priced = v.priceModel !== null && v.priceModel !== 'on_request';
  let minOrder: FieldError | null = null;
  if (ctx.kind === 'part' && v.minOrder.trim() !== '') {
    const q = parseQuantity(v.minOrder, ctx.decimals);
    if (!q.ok) minOrder = { key: `sell.quantity.${q.problem}` };
    else if (ctx.quantity != null && Number(q.value) > Number(ctx.quantity)) minOrder = { key: 'listing.errors.minOrderAboveQuantity' };
  }
  return collect<keyof PriceValues>([
    ['priceModel', v.priceModel ? null : PICK_ONE],
    ['price', priced ? amountError(v.price, PRICE_MIN_PAISE, PRICE_MAX_PAISE, false) : null],
    ['gstMode', priced && !v.gstMode ? PICK_ONE : null],
    ['minOrder', minOrder],
  ]);
}

export function pricePatch(v: PriceValues, kind: ListingKind): ListingPatch {
  const onRequest = v.priceModel === 'on_request';
  const min = kind === 'part' && v.minOrder.trim() !== '' ? parseQuantity(v.minOrder, 3) : null;
  return {
    ...(v.priceModel ? { priceModel: v.priceModel } : {}),
    pricePaise: onRequest ? null : parseRupees(v.price),
    gstMode: onRequest ? null : v.gstMode,
    ...(kind === 'part' ? { minOrderQty: min?.ok ? min.value : null } : {}),
  };
}

// ─── Rates and terms (§4.5, R25) ───

export interface RatesValues {
  hour: string;
  day: string;
  week: string;
  month: string;
  shiftHours: string;
  monthDays: string;
  overtime: string;
  minDuration: string;
  minDurationPeriod: RentalPeriod | null;
  operator: RentalOperator | null;
  operatorRate: string;
  fuel: RentalFuel;
  transport: RentalTransport | null;
  transportCharge: string;
  deposit: string;
  availableFrom: string;
  availabilityNote: string;
}

export const RATE_MAX_PAISE = 10_000_000_000;
export const DEPOSIT_MAX_PAISE = 100_000_000_000;
export const AVAILABILITY_NOTE_MAX = 200;

const RATE_FIELDS = ['hour', 'day', 'week', 'month'] as const;

export function ratesInitial(r: RentalTerms | null): RatesValues {
  return {
    hour: rupeesInput(r?.rateHourPaise),
    day: rupeesInput(r?.rateDayPaise),
    week: rupeesInput(r?.rateWeekPaise),
    month: rupeesInput(r?.rateMonthPaise),
    shiftHours: String(r?.shiftHours ?? 8),
    monthDays: String(r?.monthDays ?? 26),
    overtime: rupeesInput(r?.overtimeRateHourPaise),
    minDuration: r?.minDuration != null ? String(r.minDuration) : '',
    minDurationPeriod: r?.minDurationPeriod ?? null,
    operator: r?.operator ?? null,
    operatorRate: rupeesInput(r?.operatorRateDayPaise),
    fuel: r?.fuel ?? 'client',
    transport: r?.transport ?? null,
    transportCharge: rupeesInput(r?.transportChargePaise),
    deposit: rupeesInput(r?.depositPaise),
    availableFrom: r?.availableFrom ?? '',
    availabilityNote: r?.availabilityNote ?? '',
  };
}

/** Whether the operator is paid for (the operator rate is asked only then). */
export const operatorHasRate = (op: RentalOperator | null): boolean => op === 'optional' || op === 'mandatory';

/**
 * `today` is IST `YYYY-MM-DD`. A date that has passed is refused only when set or changed: a stored date that has
 * passed since is grandfathered (§4.5).
 */
export function validateRates(
  v: RatesValues, ctx: { today: string; previousAvailableFrom: string | null },
): FormErrors<keyof RatesValues | 'rates'> {
  const rateErrors = RATE_FIELDS.map((k) => [k, amountError(v[k], 1, RATE_MAX_PAISE, true)] as [keyof RatesValues, FieldError | null]);
  const anyRate = RATE_FIELDS.some((k) => parseRupees(v[k]) !== null && v[k].trim() !== '');
  const from = toAsciiDigits(v.availableFrom.trim());
  let fromErr: FieldError | null = null;
  if (from !== '') {
    if (!isSpecDate(from)) fromErr = { key: 'sell.validation.date' };
    else if (from !== ctx.previousAvailableFrom && from < ctx.today) fromErr = { key: 'sell.rates.availableFromPast' };
  }
  const shift = parseWhole(v.shiftHours);
  const days = parseWhole(v.monthDays);
  return collect<keyof RatesValues | 'rates'>([
    ...rateErrors,
    ['rates', anyRate || rateErrors.some(([, e]) => e) ? null : { key: 'listing.errors.rateRequired' }],
    ['shiftHours', shift === null ? REQUIRED : wholeError(v.shiftHours, 1, 24)],
    ['monthDays', days === null ? REQUIRED : wholeError(v.monthDays, 1, 31)],
    ['overtime', amountError(v.overtime, 1, RATE_MAX_PAISE, true)],
    ['minDuration', wholeError(v.minDuration, 1, 365)],
    ['minDurationPeriod', v.minDuration.trim() !== '' && !v.minDurationPeriod ? PICK_ONE : null],
    ['operatorRate', operatorHasRate(v.operator) ? amountError(v.operatorRate, 1, RATE_MAX_PAISE, true) : null],
    ['transportCharge', amountError(v.transportCharge, 1, RATE_MAX_PAISE, true)],
    ['deposit', amountError(v.deposit, 1, DEPOSIT_MAX_PAISE, true)],
    ['availableFrom', fromErr],
    ['availabilityNote', textMax(v.availabilityNote, AVAILABILITY_NOTE_MAX)],
  ]);
}

const paiseOrNull = (text: string): number | null => (text.trim() === '' ? null : parseRupees(text));

export function ratesPatch(v: RatesValues): ListingPatch {
  const minDuration = wholeOrNull(v.minDuration);
  const from = toAsciiDigits(v.availableFrom.trim());
  return {
    rental: {
      rateHourPaise: paiseOrNull(v.hour),
      rateDayPaise: paiseOrNull(v.day),
      rateWeekPaise: paiseOrNull(v.week),
      rateMonthPaise: paiseOrNull(v.month),
      shiftHours: wholeOrNull(v.shiftHours) ?? 8,
      monthDays: wholeOrNull(v.monthDays) ?? 26,
      overtimeRateHourPaise: paiseOrNull(v.overtime),
      minDuration,
      minDurationPeriod: minDuration != null ? v.minDurationPeriod : null,
      operator: v.operator,
      operatorRateDayPaise: operatorHasRate(v.operator) ? paiseOrNull(v.operatorRate) : null,
      fuel: v.fuel,
      transport: v.transport,
      transportChargePaise: paiseOrNull(v.transportCharge),
      depositPaise: paiseOrNull(v.deposit),
      availableFrom: from === '' ? null : from,
      availabilityNote: trimOrNull(v.availabilityNote),
    },
  };
}

// ─── Location and delivery (§4.7) ───

export interface LocationValues {
  source: 'business' | 'godown';
  pincode: string;
  city: string;
  state: string;
  industrialAreaId: string | null;
  industrialAreaOther: string;
  /** "Other" chosen in the area list (the text box is open). */
  otherOpen: boolean;
  addressLine: string;
  delivery: DeliveryOption[];
  /** Rentals: "Works within N km". */
  serviceRadius: string;
}

export const AREA_OTHER_MAX = 80;
export const ADDRESS_LINE_MAX = 200;

/** A draft starts at the business address with "Buyer picks up". Godown fields start empty unless stored. */
export function locationInitial(l: ListingOwnerView): LocationValues {
  const loc = l.location;
  const godown = loc.source === 'godown';
  return {
    source: loc.source,
    pincode: godown ? loc.pincode ?? '' : '',
    city: godown ? loc.city ?? '' : '',
    state: godown ? loc.state ?? '' : '',
    industrialAreaId: godown ? loc.industrialAreaId : null,
    industrialAreaOther: godown ? loc.industrialAreaOther ?? '' : '',
    otherOpen: godown && !!loc.industrialAreaOther,
    addressLine: godown ? loc.addressLine ?? '' : '',
    delivery: l.delivery.length > 0 ? [...l.delivery] : ['pickup'],
    serviceRadius: l.rental?.serviceRadiusKm != null ? String(l.rental.serviceRadiusKm) : '',
  };
}

export function validateLocation(v: LocationValues, kind: ListingKind): FormErrors<keyof LocationValues> {
  const godown = v.source === 'godown';
  return collect<keyof LocationValues>([
    ['pincode', godown && !PINCODE_REGEX.test(toAsciiDigits(v.pincode.trim())) ? { key: 'sell.location.pincode' } : null],
    ['city', godown && v.city.trim() === '' ? REQUIRED : null],
    ['state', godown && v.state.trim() === '' ? REQUIRED : null],
    ['industrialAreaOther', godown && v.otherOpen ? textMax(v.industrialAreaOther, AREA_OTHER_MAX) : null],
    ['addressLine', godown ? textMax(v.addressLine, ADDRESS_LINE_MAX) : null],
    ['delivery', v.delivery.length > 0 ? null : { key: 'sell.location.deliveryRequired' }],
    ['serviceRadius', kind === 'machine_rental' ? wholeError(v.serviceRadius, 1, 2000) : null],
  ]);
}

export function locationPatch(v: LocationValues, pin: { lat: number; lng: number } | null, kind: ListingKind): ListingPatch {
  const location: ListingPatch['location'] = v.source === 'business'
    ? { source: 'business' }
    : {
        source: 'godown',
        pincode: toAsciiDigits(v.pincode.trim()),
        city: v.city.trim(),
        state: v.state.trim(),
        industrialAreaId: v.otherOpen ? null : v.industrialAreaId,
        industrialAreaOther: v.otherOpen ? trimOrNull(v.industrialAreaOther) : null,
        addressLine: trimOrNull(v.addressLine),
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
      };
  return {
    location,
    delivery: [...v.delivery],
    ...(kind === 'machine_rental' ? { rental: { serviceRadiusKm: wholeOrNull(v.serviceRadius) } } : {}),
  };
}

// ─── Preview ───

/** The sanity flags Preview warns about (§5.4): the shared rule on the draft, with its unit's machine flag. */
export function previewFlags(l: ListingOwnerView, units: readonly Pick<Unit, 'id' | 'isMachineUnit'>[]): ListingFlag[] {
  return sanityFlags({
    kind: l.kind,
    priceModel: l.priceModel,
    pricePaise: l.pricePaise,
    quantity: l.quantity,
    unitIsMachineUnit: !!units.find((u) => u.id === l.unitId)?.isMachineUnit,
    rental: l.rental,
  });
}
