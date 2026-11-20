import * as Yup from 'yup';
import {
  complementarySide,
  normalizePartNumber,
  PART_REQUEST_LIMITS,
  partNumberBase,
  type ListingDetail,
  type PartRequestAudience,
  type PartRequestBuyerView,
  type PartRequestFitInput,
  type PartRequestInput,
  type PartRequestKind,
  type PartRequestPatch,
  type PartRequestPrefill,
  type PartRequestReach,
  type PartSide,
  type QueryReading,
  type Specs,
} from '@mpm/shared-types';
import { toAsciiDigits } from './digits';
import { parseRupees, rupeesInput } from './money';
import { parseQuantity } from './quantity';

// Post a requirement (F8 spec §13.1, §13.2, §5.1; textile `lib/requirement-form.ts`, `lib/requirement-prefill.ts`):
// the form's values as the fields hold them, the Yup rules, the API body and patch, and the prefill builders (No
// results, Other side, Post again). Pure: the screen owns the state, the API checks every rule again.

/** A "fits" row as the form keeps it: the ids the API takes plus the names for the row, when known. */
export interface FormFit {
  brandId: string;
  brandName: string | null;
  modelId: string | null;
  modelName: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

/** A reference photo: its upload key, and a local or signed URL for the thumbnail (null while unknown). */
export interface FormPhoto {
  key: string;
  uri: string | null;
}

export interface RequestFormValues {
  kind: PartRequestKind;
  categoryId: string | null;
  /** A machine category from a search reading: the picker opens there; never sent (§13.2). */
  categorySeedId: string | null;
  name: string;
  partNumber: string;
  side: PartSide | null;
  /** As typed (Hindi / Gujarati digits allowed). Parts only; a machine request asks for one. */
  quantity: string;
  unitId: string | null;
  fits: FormFit[];
  /** null = every condition (the chips all on, sent as "any"). */
  conditionIds: string[] | null;
  /** Rupees per unit, as typed; '' = no budget. */
  budget: string;
  budgetVisible: boolean;
  /** `YYYY-MM-DD` (IST) or null. */
  neededBy: string | null;
  urgent: boolean;
  reach: PartRequestReach;
  audience: PartRequestAudience;
  validityDays: number;
  specs: Specs;
  photos: FormPhoto[];
  note: string;
}

export const PART_NUMBER_MAX = 60;
/** The API's budget ceiling (an int4 of paise). */
export const BUDGET_MAX_PAISE = 2_147_483_647;
const MAX_DAYS_AHEAD = 365;

/** A fresh form (§5.1 defaults): a part, every condition, budget private, 200 km, verified sellers only. */
export function emptyRequestValues(defaultValidityDays = 15): RequestFormValues {
  return {
    kind: 'part',
    categoryId: null,
    categorySeedId: null,
    name: '',
    partNumber: '',
    side: null,
    quantity: '',
    unitId: null,
    fits: [],
    conditionIds: null,
    budget: '',
    budgetVisible: false,
    neededBy: null,
    urgent: false,
    reach: 'radius_200',
    audience: 'verified_only',
    validityDays: defaultValidityDays,
    specs: {},
    photos: [],
    note: '',
  };
}

/** The API's decimal string as a field shows it: `"4.000"` → `"4"`, `"2.500"` → `"2.5"`. */
export function plainQuantity(q: string): string {
  return q.includes('.') ? q.replace(/0+$/, '').replace(/\.$/, '') : q;
}

const fitFromInput = (f: PartRequestFitInput): FormFit => ({
  brandId: f.brandId,
  brandName: null,
  modelId: f.modelId ?? null,
  modelName: null,
  yearFrom: f.yearFrom ?? null,
  yearTo: f.yearTo ?? null,
});

/** A fresh form with a prefill applied (the form never posts by itself: the buyer reviews and taps Post). */
export function valuesFromPrefill(prefill: PartRequestPrefill | null | undefined, defaultValidityDays = 15): RequestFormValues {
  const v = emptyRequestValues(defaultValidityDays);
  if (!prefill) return v;
  return {
    ...v,
    kind: prefill.kind ?? v.kind,
    categoryId: prefill.categoryId ?? null,
    categorySeedId: prefill.categorySeedId ?? null,
    name: prefill.name ?? '',
    partNumber: prefill.partNumber ?? '',
    side: prefill.side === 'not_applicable' ? null : (prefill.side ?? null),
    quantity: prefill.quantity ? plainQuantity(prefill.quantity) : '',
    unitId: prefill.unitId ?? null,
    fits: (prefill.fits ?? []).slice(0, PART_REQUEST_LIMITS.fitsMax).map(fitFromInput),
  };
}

// ─── Validation ───

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface RequestSchemaContext {
  /** The picked node's effective sides (a part's side is then Left, Right or Pair). */
  hasSides: boolean;
  /** The picked unit's decimals; null before a unit is picked. */
  unitDecimals: number | null;
  /** Today in India (`istDateKey()`), for "needed by". */
  today: string;
  /** Edit: the stored "needed by"; kept as is, it isn't refused for being in the past now. */
  baselineNeededBy?: string | null;
}

/** `YYYY-MM-DD` + `days` (calendar arithmetic on the date string). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const QUANTITY_ERROR_KEYS = {
  empty: 'requirements.form.errors.quantity',
  invalid: 'requirements.form.errors.quantityInvalid',
  decimals: 'requirements.form.errors.quantityDecimals',
  zero: 'requirements.form.errors.quantityInvalid',
  tooLarge: 'requirements.form.errors.quantityTooLarge',
} as const;

/**
 * The form's rules (§5.1): category; name 3–100; part number ≤ 60; side Left / Right / Pair when a part's node has
 * sides; a part's quantity and unit (decimals per unit); at least one condition; budget a valid amount; needed by today …
 * a year from today; note ≤ 500; ≤ 3 photos; ≤ 5 fits. Build it inside the component so messages follow the language.
 */
export function requestFormSchema(t: Translate, ctx: RequestSchemaContext) {
  const L = PART_REQUEST_LIMITS;
  return Yup.object({
    kind: Yup.mixed<PartRequestKind>().oneOf(['part', 'machine']).required(),
    categoryId: Yup.string().nullable().required(t('requirements.form.errors.category')),
    name: Yup.string()
      .trim()
      .required(t('requirements.form.errors.name', { min: L.nameMin }))
      .min(L.nameMin, t('requirements.form.errors.name', { min: L.nameMin }))
      .max(L.nameMax, t('requirements.form.errors.nameMax', { max: L.nameMax })),
    partNumber: Yup.string().trim().max(PART_NUMBER_MAX, t('requirements.form.errors.partNumberMax', { max: PART_NUMBER_MAX })),
    side: Yup.mixed<PartSide>()
      .nullable()
      .test('side', t('requirements.form.errors.side'), function test(side) {
        const { kind } = this.parent as RequestFormValues;
        if (kind !== 'part' || !ctx.hasSides) return true;
        return side === 'left' || side === 'right' || side === 'pair';
      }),
    unitId: Yup.string()
      .nullable()
      .test('unit', t('requirements.form.errors.unit'), function test(unitId) {
        return (this.parent as RequestFormValues).kind !== 'part' || !!unitId;
      }),
    quantity: Yup.string().test('quantity', function test(text) {
      const { kind } = this.parent as RequestFormValues;
      if (kind !== 'part') return true;
      const r = parseQuantity(text ?? '', ctx.unitDecimals ?? 3);
      return r.ok ? true : this.createError({ message: t(QUANTITY_ERROR_KEYS[r.problem], { decimals: ctx.unitDecimals ?? 0 }) });
    }),
    fits: Yup.array().max(L.fitsMax, t('requirements.form.errors.fitsMax', { max: L.fitsMax })),
    conditionIds: Yup.array(Yup.string().required())
      .nullable()
      .test('conditions', t('requirements.form.errors.conditions'), (ids) => ids == null || ids.length > 0),
    budget: Yup.string().test('budget', t('requirements.form.errors.budget'), (text) => {
      if (!text || !text.trim()) return true;
      const paise = parseRupees(text);
      return paise !== null && paise >= 100 && paise <= BUDGET_MAX_PAISE;
    }),
    neededBy: Yup.string()
      .nullable()
      .test('neededBy', t('requirements.form.errors.neededBy'), (d) => d == null || (!!ctx.baselineNeededBy && d === ctx.baselineNeededBy) || (d >= ctx.today && d <= addDays(ctx.today, MAX_DAYS_AHEAD))),
    photos: Yup.array().max(L.photosMax, t('requirements.form.errors.photosMax', { max: L.photosMax })),
    note: Yup.string().max(L.noteMax, t('requirements.form.errors.noteMax', { max: L.noteMax })),
  });
}

export type RequestFormErrors = Partial<Record<keyof RequestFormValues, string>>;

/** Every broken rule, by field (first message per field); empty when the form can be sent. */
export function validateRequestForm(schema: ReturnType<typeof requestFormSchema>, values: RequestFormValues): RequestFormErrors {
  try {
    schema.validateSync(values, { abortEarly: false });
    return {};
  } catch (err) {
    if (!(err instanceof Yup.ValidationError)) throw err;
    const out: RequestFormErrors = {};
    for (const e of err.inner.length ? err.inner : [err]) {
      const field = (e.path ?? '').split(/[.[]/)[0] as keyof RequestFormValues;
      if (field && !out[field]) out[field] = e.message;
    }
    return out;
  }
}

/** The step a field is on: step 1 "What do you need?", step 2 "A few more details". */
export const STEP_ONE_FIELDS: readonly (keyof RequestFormValues)[] = ['categoryId', 'name', 'partNumber', 'side', 'unitId', 'quantity', 'fits'];

// ─── To the API ───

const trimmed = (s: string): string | null => {
  const v = s.trim();
  return v === '' ? null : v;
};

/** A part's quantity as the API takes it (`"1,200.50"` → `"1200.5"`); a machine request asks for one. */
function quantityOf(v: RequestFormValues): string {
  if (v.kind !== 'part') return '1';
  const r = parseQuantity(v.quantity, 3);
  return r.ok ? r.value : toAsciiDigits(v.quantity).replace(/[,\s]/g, '');
}

const fitInput = (f: FormFit): PartRequestFitInput => ({
  brandId: f.brandId,
  ...(f.modelId ? { modelId: f.modelId } : {}),
  ...(f.yearFrom != null ? { yearFrom: f.yearFrom } : {}),
  ...(f.yearTo != null ? { yearTo: f.yearTo } : {}),
});

const cleanSpecs = (specs: Specs): Specs =>
  Object.fromEntries(Object.entries(specs).filter(([, v]) => !(v === null || v === '' || (Array.isArray(v) && v.length === 0)))) as Specs;

/** `POST /part-requests` body, empty optionals left out. Call once `validateRequestForm` is empty. */
/**
 * `hasSides`: the picked node's effective sides. A side is sent only for a part on a node with sides — a prefill's side
 * word on a node without them would otherwise be refused (`400 SIDE_NOT_ALLOWED`) on every post.
 */
export function toPartRequestInput(v: RequestFormValues, { hasSides = true }: { hasSides?: boolean } = {}): PartRequestInput {
  const part = v.kind === 'part';
  const partNumber = part ? trimmed(v.partNumber) : null;
  const budget = v.budget.trim() ? parseRupees(v.budget) : null;
  const note = trimmed(v.note);
  const specs = cleanSpecs(v.specs);
  const input: PartRequestInput = {
    kind: v.kind,
    categoryId: v.categoryId!,
    name: v.name.trim(),
    quantity: quantityOf(v),
    reach: v.reach,
    audience: v.audience,
    validityDays: v.validityDays,
  };
  if (partNumber) input.partNumber = partNumber;
  if (part && hasSides && v.side && v.side !== 'not_applicable') input.side = v.side;
  if (v.fits.length > 0) input.fits = v.fits.map(fitInput);
  if (Object.keys(specs).length > 0) input.specs = specs;
  if (part && v.unitId) input.unitId = v.unitId;
  if (v.conditionIds !== null) input.conditionIds = [...v.conditionIds];
  if (budget !== null) {
    input.budgetPerUnitPaise = budget;
    input.budgetVisible = v.budgetVisible;
  }
  if (v.neededBy) input.neededBy = v.neededBy;
  if (v.urgent) input.urgent = true;
  if (v.photos.length > 0) input.photoKeys = v.photos.map((p) => p.key);
  if (note) input.note = note;
  return input;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `PATCH /part-requests/:id`: only what changed from `baseline` (the form as loaded), so text the API shows masked
 * (name, note) is never sent back unless the buyer edited it; cleared optionals go as null. `photoKeys` is the full
 * final list when the photos changed (§12.2).
 */
export function toPartRequestPatch(
  v: RequestFormValues,
  baseline: RequestFormValues,
  version: number,
  { hasSides = true }: { hasSides?: boolean } = {},
): PartRequestPatch {
  // The baseline is what is stored (its side included), so a node without sides clears a stored side.
  const now = toPartRequestInput(v, { hasSides });
  const before = toPartRequestInput(baseline);
  const patch: PartRequestPatch = { version };
  const set = <K extends keyof PartRequestPatch>(k: K, value: PartRequestPatch[K]) => {
    patch[k] = value;
  };
  if (now.categoryId !== before.categoryId) set('categoryId', now.categoryId);
  if (now.name !== before.name) set('name', now.name);
  if (!same(now.partNumber, before.partNumber)) set('partNumber', now.partNumber ?? null);
  if (!same(now.side, before.side)) set('side', now.side ?? null);
  if (!same(now.fits ?? [], before.fits ?? [])) set('fits', now.fits ?? []);
  if (!same(now.specs ?? {}, before.specs ?? {})) set('specs', now.specs ?? {});
  if (now.quantity !== before.quantity) set('quantity', now.quantity);
  if (!same(now.unitId, before.unitId) && now.unitId) set('unitId', now.unitId);
  if (!same(now.conditionIds ?? [], before.conditionIds ?? [])) set('conditionIds', now.conditionIds ?? []);
  if (!same(now.budgetPerUnitPaise, before.budgetPerUnitPaise)) set('budgetPerUnitPaise', now.budgetPerUnitPaise ?? null);
  if ((now.budgetVisible ?? false) !== (before.budgetVisible ?? false)) set('budgetVisible', now.budgetVisible ?? false);
  if (!same(now.neededBy, before.neededBy)) set('neededBy', now.neededBy ?? null);
  if ((now.urgent ?? false) !== (before.urgent ?? false)) set('urgent', now.urgent ?? false);
  if (now.reach !== before.reach) set('reach', now.reach);
  if (now.audience !== before.audience) set('audience', now.audience);
  if (!same(now.photoKeys ?? [], before.photoKeys ?? [])) set('photoKeys', now.photoKeys ?? []);
  if (!same(now.note, before.note)) set('note', now.note ?? null);
  return patch;
}

/** Whether a patch changes anything (beyond its `version`). */
export const patchChanges = (patch: PartRequestPatch): boolean => Object.keys(patch).some((k) => k !== 'version');

// ─── From the API ───

/** The edit form, from the buyer's own view (§13.1 edit mode). Photos carry their keys; thumbnails load separately. */
export function fromBuyerView(view: PartRequestBuyerView): RequestFormValues {
  return {
    kind: view.kind,
    categoryId: view.categoryId,
    categorySeedId: null,
    name: view.name,
    partNumber: view.partNumber ?? '',
    side: view.side === 'not_applicable' ? null : view.side,
    quantity: plainQuantity(view.quantity),
    unitId: view.unit.id,
    fits: view.fits.map((f) => ({ ...f })),
    conditionIds: view.conditionIds.length > 0 ? [...view.conditionIds] : null,
    budget: rupeesInput(view.budgetPerUnitPaise),
    budgetVisible: view.budgetVisible,
    neededBy: view.neededBy,
    urgent: view.urgent,
    reach: view.reach,
    audience: view.audience,
    validityDays: view.validityDays,
    specs: { ...view.specs },
    photos: view.photoKeys.map((key) => ({ key, uri: null })),
    note: view.note ?? '',
  };
}

const fitPrefill = (f: { brandId: string; modelId: string | null; yearFrom: number | null; yearTo: number | null }): PartRequestFitInput => ({
  brandId: f.brandId,
  modelId: f.modelId,
  yearFrom: f.yearFrom,
  yearTo: f.yearTo,
});

/** "Post again" (closed / expired / fulfilled): the identity of the request into a new form (`source: 'copy'`). */
export function copyOf(view: PartRequestBuyerView): PartRequestPrefill {
  const prefill: PartRequestPrefill = {
    source: 'copy',
    kind: view.kind,
    categoryId: view.categoryId,
    name: view.name,
    quantity: view.quantity,
    unitId: view.unit.id,
  };
  if (view.partNumber) prefill.partNumber = view.partNumber;
  if (view.side && view.side !== 'not_applicable') prefill.side = view.side;
  if (view.fits.length > 0) prefill.fits = view.fits.slice(0, PART_REQUEST_LIMITS.fitsMax).map(fitPrefill);
  return prefill;
}

/**
 * No results → "Post this as a requirement" (§13.2, (my call) 28): a part group or machine type becomes the category, a
 * machine category only seeds the picker; the first part number; the side; brand (+ model) → one fit; the name is the
 * reading's words, else the raw query.
 */
export function prefillFromReading(
  reading: QueryReading | null | undefined,
  rawQuery: string,
  /** Brands that make machines (master data); a brand chip becomes a fit only for one of them. Null: none yet. */
  machineBrandIds: ReadonlySet<string> | null = null,
): PartRequestPrefill {
  const prefill: PartRequestPrefill = { source: 'no_results' };
  const raw = rawQuery.trim().replace(/\s+/g, ' ');
  if (!reading) {
    if (raw) prefill.name = raw.slice(0, PART_REQUEST_LIMITS.nameMax);
    return prefill;
  }
  const cat = reading.category;
  if (cat) {
    if (cat.level === 'machine_category') prefill.categorySeedId = cat.id;
    else prefill.categoryId = cat.id;
  }
  const pn = reading.partNumbers[0];
  if (pn) prefill.partNumber = pn;
  if (reading.side) prefill.side = reading.side;
  const brandId = reading.brand?.id ?? reading.model?.brandId ?? null;
  if (brandId && machineBrandIds?.has(brandId)) {
    const modelId = reading.model && reading.model.brandId === brandId ? reading.model.id : null;
    prefill.fits = [{ brandId, modelId, yearFrom: null, yearTo: null }];
  }
  const words = reading.words.join(' ').trim();
  const name = words.length >= PART_REQUEST_LIMITS.nameMin ? words : raw;
  if (name) prefill.name = name.slice(0, PART_REQUEST_LIMITS.nameMax);
  return prefill;
}

/**
 * Other side → "Need the other side? Post a requirement" (§13.2): the listing's category, its title, the part number's
 * side-less base, the complementary side (none for a Pair: the buyer picks), the listing's fits (≤ 5; a typed "other
 * model" becomes the brand alone).
 */
export function prefillFromOtherSide(listing: Pick<ListingDetail, 'kind' | 'categoryId' | 'title' | 'partNumber' | 'side' | 'fitments'>): PartRequestPrefill {
  const prefill: PartRequestPrefill = { source: 'other_side', kind: 'part' };
  if (listing.categoryId) prefill.categoryId = listing.categoryId;
  const name = listing.title.trim();
  if (name) prefill.name = name.slice(0, PART_REQUEST_LIMITS.nameMax);
  if (listing.partNumber) {
    const norm = normalizePartNumber(listing.partNumber);
    const base = norm ? partNumberBase(norm, listing.side) : '';
    if (base) prefill.partNumber = base;
  }
  const want = listing.side ? complementarySide(listing.side) : null;
  if (want) prefill.side = want;
  if (listing.fitments.length > 0) {
    prefill.fits = listing.fitments.slice(0, PART_REQUEST_LIMITS.fitsMax).map((f) => ({
      brandId: f.brandId,
      modelId: f.modelId,
      yearFrom: f.yearFrom,
      yearTo: f.yearTo,
    }));
  }
  return prefill;
}

// ─── Labels ───

export interface ReachChoice {
  value: PartRequestReach;
  /** Translation key and params; `text` is shown as is (the business's state, catalogue data). */
  key: string;
  params?: Record<string, unknown>;
  text?: string;
}

/** The reach chips (§13.1): 50 km, 200 km, the business's state (when known), All India. */
export function reachChoices(state: string | null): ReachChoice[] {
  const out: ReachChoice[] = [
    { value: 'radius_50', key: 'requirements.form.reach.km', params: { km: 50 } },
    { value: 'radius_200', key: 'requirements.form.reach.km', params: { km: 200 } },
  ];
  if (state && state.trim()) out.push({ value: 'state', key: 'requirements.form.reach.state', text: state.trim() });
  out.push({ value: 'all_india', key: 'requirements.form.reach.allIndia' });
  return out;
}

/** "Needed by" quick choices: none, or today + 7 / 14 / 30 days (IST). */
export const NEEDED_BY_DAYS = [7, 14, 30] as const;

/** The value to send for a "needed by" choice. */
export function neededByFor(days: number | null, today: string): string | null {
  return days === null ? null : addDays(today, days);
}
