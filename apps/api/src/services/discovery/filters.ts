import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  LISTING_KINDS,
  REMOVABLE_CHIPS,
  SEARCH_SORTS,
  type ListingKind,
  type SearchFilters,
  type SearchSide,
  type SpecRange,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { categories, listings, templateFieldOptions, templateFields } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { withinRadiusSql, type LatLng } from './distance.js';
import { discoveryWhere } from './visibility.js';

// Search request validation and filters (F4 + F5 spec §5.7, §7). Strict schemas: an unknown key is a 400. Each filter
// group is its own SQL part so the facets (§5.9) can leave out their own group.

type Conn = Db | Tx;

const uuid = z.string().uuid();
/** A listing-type filter: empty = all. */
export const kindsSchema = z.array(z.enum(LISTING_KINDS)).max(LISTING_KINDS.length);
const latLng = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) }).strict();
const pincode = z.string().regex(/^\d{6}$/);

export const originSchema = z
  .union([
    z
      .object({
        point: latLng,
        fallback: z.union([z.object({ business: z.literal(true) }).strict(), z.object({ pincode }).strict()]).optional(),
      })
      .strict(),
    z.object({ pincode }).strict(),
    z.object({ business: z.literal(true) }).strict(),
  ])
  .nullable();

// The literals mirror DISCOVERY_RADII_KM and MIN_QTY_STEPS (a test checks they agree).
export const radiusSchema = z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100), z.literal(200), z.null()]);
const minQty = z.union([z.literal(2), z.literal(10), z.literal(50)]);
const money = z.number().int().min(0).max(1_000_000_000_000);
const specKey = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
const specRange = z.object({ min: z.number().finite().optional(), max: z.number().finite().optional() }).strict();

export const searchFiltersSchema = z
  .object({
    kinds: kindsSchema.optional(),
    categoryId: uuid.optional(),
    side: z.enum(['left', 'right', 'pair']).optional(),
    fit: z.object({ brandId: uuid, modelId: uuid.optional(), year: z.number().int().min(1900).max(2100).optional() }).strict().optional(),
    brandId: uuid.optional(),
    conditionIds: z.array(uuid).max(20).optional(),
    radiusKm: radiusSchema.optional(),
    states: z.array(z.string().trim().min(1).max(100)).max(40).optional(),
    cities: z.array(z.string().trim().min(1).max(100)).max(40).optional(),
    industrialAreaIds: z.array(uuid).max(50).optional(),
    priceMinPaise: money.optional(),
    priceMaxPaise: money.optional(),
    hidePriceOnRequest: z.boolean().optional(),
    minQty: minQty.optional(),
    gstVerifiedOnly: z.boolean().optional(),
    delivers: z.boolean().optional(),
    hasVideo: z.boolean().optional(),
    specs: z.record(specKey, z.union([z.array(z.string().min(1).max(64)).max(50), specRange])).optional(),
  })
  .strict();

const searchFields = {
  q: z.string().max(200).optional(),
  filters: searchFiltersSchema.optional(),
  removedChips: z.array(z.enum(REMOVABLE_CHIPS)).max(REMOVABLE_CHIPS.length).optional(),
  sort: z.enum(SEARCH_SORTS).optional(),
  origin: originSchema.optional(),
};

/** `POST /discover/search` body. */
export const searchRequestSchema = z.object({ ...searchFields, cursor: z.string().max(2_000).nullable().optional() }).strict();
/** `POST /discover/search/count` body: no cursor. */
export const searchCountSchema = z.object(searchFields).strict();

export function filterNotAvailable(field: string): ValidationError {
  return new ValidationError('This filter is not available here', { field }, 'FILTER_NOT_AVAILABLE');
}

// ─── Spec fields in play (§5.7) ───

export interface SpecFieldInPlay {
  key: string;
  label: string;
  type: 'single_select' | 'multi_select' | 'number';
  unit: string | null;
  options: Array<{ key: string; label: string }>;
}

/** Which `applies_to` values a kinds filter allows: parts only, machines only, or both. */
function appliesToFor(kinds: readonly ListingKind[]): Array<'parts' | 'machines' | 'both'> {
  const parts = kinds.length === 0 || kinds.includes('part');
  const machines = kinds.length === 0 || kinds.some((k) => k !== 'part');
  return ['both', ...(parts ? (['parts'] as const) : []), ...(machines ? (['machines'] as const) : [])];
}

/**
 * The filterable select and number fields of the category in play and its ancestors, active, for the kinds in play
 * (`applies_to`); a deeper node's field of the same key wins. Select fields carry their active options.
 */
export async function specFieldsInPlay(conn: Conn, categoryPath: string | null, kinds: readonly ListingKind[]): Promise<SpecFieldInPlay[]> {
  if (!categoryPath) return [];
  const parts = categoryPath.split('/');
  const paths = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  const rows = await conn
    .select({
      id: templateFields.id,
      key: templateFields.key,
      label: templateFields.label,
      type: templateFields.type,
      unit: templateFields.unit,
      path: categories.path,
      sortOrder: templateFields.sortOrder,
    })
    .from(templateFields)
    .innerJoin(categories, eq(categories.id, templateFields.categoryId))
    .where(
      and(
        inArray(categories.path, paths),
        eq(templateFields.status, 'active'),
        eq(templateFields.filterable, true),
        inArray(templateFields.type, ['single_select', 'multi_select', 'number']),
        inArray(templateFields.appliesTo, appliesToFor(kinds)),
      ),
    );
  rows.sort((a, b) => a.path.length - b.path.length || a.sortOrder - b.sortOrder);
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byKey.set(r.key, r);
  const fields = [...byKey.values()];
  const selectIds = fields.filter((f) => f.type !== 'number').map((f) => f.id);
  const options = selectIds.length
    ? await conn
        .select({ fieldId: templateFieldOptions.fieldId, key: templateFieldOptions.key, label: templateFieldOptions.label })
        .from(templateFieldOptions)
        .where(and(inArray(templateFieldOptions.fieldId, selectIds), eq(templateFieldOptions.status, 'active')))
        .orderBy(templateFieldOptions.sortOrder, templateFieldOptions.key)
    : [];
  return fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type as SpecFieldInPlay['type'],
    unit: f.unit,
    options: options.filter((o) => o.fieldId === f.id).map((o) => ({ key: o.key, label: o.label })),
  }));
}

// ─── SQL parts ───

/** A filter group the facets leave out one at a time (§5.9). `spec:<key>` for a spec field. */
export type FacetGroup = 'kinds' | 'side' | 'conditions' | 'gst' | 'delivers' | 'states' | `spec:${string}`;

export interface FilterContext {
  filters: SearchFilters;
  kinds: ListingKind[];
  side: SearchSide | null;
  /** The category in play (filter or chip): its path. */
  categoryPath: string | null;
  /** Reader chips (unless overridden by `fit`). */
  brandChipId: string | null;
  modelChipId: string | null;
  /** The model chip's brand: a brand-wide fitment of it fits the model too. */
  modelChipBrandId: string | null;
  origin: LatLng | null;
  /** Effective radius; null = All India (or no origin). */
  radiusKm: number | null;
  specFields: SpecFieldInPlay[];
}

export interface FilterParts {
  /** Always applied. */
  base: SQL[];
  /** Within the radius (§6.2); null without an origin or for All India. Widen leaves it out. */
  radius: SQL | null;
  groups: Map<FacetGroup, SQL>;
}

const list = (xs: readonly string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

/** The side filter (R6): Left = Left + Pair, Right = Right + Pair, Pair = Pair. */
export function sideFilterSql(side: SearchSide): SQL {
  return side === 'pair' ? sql`${listings.side} = 'pair'` : sql`${listings.side} IN (${side}, 'pair')`;
}

/**
 * The brand chip (§5.3) and the `brandId` filter: the listing's part brand, a fitment's brand or its machine make. The
 * brand view's `allCount` counts this too, so the count and the search it opens can't drift.
 */
export function brandChipSql(brandId: string): SQL {
  return sql`(${listings.partBrandId} = ${brandId}
    OR EXISTS (SELECT 1 FROM listing_fitments bf WHERE bf.listing_id = ${listings.id} AND bf.brand_id = ${brandId})
    OR EXISTS (SELECT 1 FROM listing_machines bm WHERE bm.listing_id = ${listings.id} AND bm.brand_id = ${brandId}))`;
}

/** Per unit for parts and machines; a rental's headline rate (day, hour, week, month); NULL for Price on request. */
export const priceSql: SQL = sql`(CASE
  WHEN ${listings.kind} = 'machine_rental' THEN (SELECT COALESCE(r.rate_day_paise, r.rate_hour_paise, r.rate_week_paise, r.rate_month_paise)
    FROM listing_rentals r WHERE r.listing_id = ${listings.id})
  WHEN ${listings.priceModel} = 'on_request' THEN NULL
  ELSE ${listings.pricePaise} END)`;

/** Builds every filter of §5.7 as SQL; spec filters checked against the fields in play (`400 FILTER_NOT_AVAILABLE`). */
export function filterParts(ctx: FilterContext): FilterParts {
  const f = ctx.filters;
  const base: SQL[] = [];
  const groups = new Map<FacetGroup, SQL>();

  if (ctx.categoryPath) {
    base.push(sql`${listings.categoryId} IN (SELECT c.id FROM categories c WHERE c.path = ${ctx.categoryPath} OR c.path LIKE ${`${ctx.categoryPath}/%`})`);
  }
  const radius = ctx.origin && ctx.radiusKm !== null ? withinRadiusSql(listings.searchPoint, ctx.origin, ctx.radiusKm) : null;

  if (f.fit) {
    const { brandId, modelId, year } = f.fit;
    // A fitment for the whole brand (no model, no "Other" model) fits every model of it, as F2's other side.
    const fModel = modelId ? sql` AND (f.model_id = ${modelId} OR (f.model_id IS NULL AND f.model_other IS NULL))` : sql``;
    const fYear = year !== undefined ? sql` AND (f.year_from IS NULL OR f.year_from <= ${year}) AND (f.year_to IS NULL OR f.year_to >= ${year})` : sql``;
    const mModel = modelId ? sql` AND m.model_id = ${modelId}` : sql``;
    const mYear = year !== undefined ? sql` AND m.year = ${year}` : sql``;
    base.push(sql`(EXISTS (SELECT 1 FROM listing_fitments f WHERE f.listing_id = ${listings.id} AND f.brand_id = ${brandId}${fModel}${fYear})
      OR EXISTS (SELECT 1 FROM listing_machines m WHERE m.listing_id = ${listings.id} AND m.brand_id = ${brandId}${mModel}${mYear}))`);
  }
  // The brand: the `brandId` filter (with or without `fit`), else the reader's chip unless `fit` overrides it.
  const brandId = f.brandId ?? (f.fit ? null : ctx.brandChipId);
  if (brandId) base.push(brandChipSql(brandId));
  if (!f.fit && ctx.modelChipId) {
    const m = ctx.modelChipId;
    const brandWide = ctx.modelChipBrandId
      ? sql` OR (f.brand_id = ${ctx.modelChipBrandId} AND f.model_id IS NULL AND f.model_other IS NULL)`
      : sql``;
    base.push(sql`(EXISTS (SELECT 1 FROM listing_fitments f WHERE f.listing_id = ${listings.id} AND (f.model_id = ${m}${brandWide}))
      OR EXISTS (SELECT 1 FROM listing_machines mm WHERE mm.listing_id = ${listings.id} AND mm.model_id = ${m}))`);
  }

  if (f.cities?.length) base.push(sql`lower(${listings.city}) IN (${list(f.cities.map((c) => c.toLowerCase()))})`);
  if (f.industrialAreaIds?.length) base.push(inArray(listings.industrialAreaId, f.industrialAreaIds));
  if (f.priceMinPaise !== undefined || f.priceMaxPaise !== undefined || f.hidePriceOnRequest) {
    const range: SQL[] = [];
    if (f.priceMinPaise !== undefined) range.push(sql`${priceSql} >= ${f.priceMinPaise}`);
    if (f.priceMaxPaise !== undefined) range.push(sql`${priceSql} <= ${f.priceMaxPaise}`);
    const priced = range.length ? sql.join(range, sql` AND `) : sql`${priceSql} IS NOT NULL`;
    base.push(f.hidePriceOnRequest ? sql`(${priced})` : sql`(${priceSql} IS NULL OR (${priced}))`);
  }
  // F6 + F7 §8.4: what is still available, not the listed quantity (facet counts share this clause).
  if (f.minQty !== undefined) base.push(sql`(${listings.quantity} - ${listings.heldQuantity}) >= ${f.minQty}`);
  if (f.hasVideo) base.push(sql`EXISTS (SELECT 1 FROM listing_media vm WHERE vm.listing_id = ${listings.id} AND vm.type = 'video')`);

  if (ctx.kinds.length) groups.set('kinds', inArray(listings.kind, ctx.kinds));
  if (ctx.side) groups.set('side', sideFilterSql(ctx.side));
  if (f.conditionIds?.length) groups.set('conditions', inArray(listings.conditionId, f.conditionIds));
  if (f.gstVerifiedOnly) groups.set('gst', gstSql);
  if (f.delivers) groups.set('delivers', deliversSql);
  if (f.states?.length) groups.set('states', inArray(listings.state, f.states));

  if (f.specs) {
    const fields = new Map(ctx.specFields.map((s) => [s.key, s]));
    for (const [key, value] of Object.entries(f.specs)) {
      const field = fields.get(key);
      if (!field) throw filterNotAvailable(`specs.${key}`);
      groups.set(`spec:${key}`, specFilterSql(field, value));
    }
  }
  return { base, radius, groups };
}

export const gstSql: SQL = sql`EXISTS (SELECT 1 FROM businesses gb WHERE gb.id = ${listings.businessId} AND gb.verification_levels ? 'gst')`;
export const deliversSql: SQL = sql`${listings.delivery} && ARRAY['ship', 'local_delivery']::text[]`;

/** A spec value as JSON text values (a select value or each element of a multi-select array). */
function specValue(key: string): SQL {
  return sql`(${listings.specs} -> ${key})`;
}

/** A select field: any of the options (a blank value fails); a number field: within the range (a blank value fails). */
export function specFilterSql(field: SpecFieldInPlay, value: string[] | SpecRange): SQL {
  const v = specValue(field.key);
  if (field.type === 'number') {
    if (Array.isArray(value)) throw filterNotAvailable(`specs.${field.key}`);
    const n = sql`(CASE WHEN jsonb_typeof(${v}) = 'number' THEN (${v})::text::numeric END)`;
    const conds: SQL[] = [sql`${n} IS NOT NULL`];
    if (value.min !== undefined) conds.push(sql`${n} >= ${value.min}`);
    if (value.max !== undefined) conds.push(sql`${n} <= ${value.max}`);
    return sql`(${sql.join(conds, sql` AND `)})`;
  }
  if (!Array.isArray(value)) throw filterNotAvailable(`specs.${field.key}`);
  const known = new Set(field.options.map((o) => o.key));
  if (value.some((k) => !known.has(k))) throw filterNotAvailable(`specs.${field.key}`);
  const arr = sql`${sql.param(value)}::text[]`;
  return sql`((jsonb_typeof(${v}) = 'array' AND ${v} ?| ${arr}) OR (jsonb_typeof(${v}) = 'string' AND (${v} #>> '{}') = ANY(${arr})))`;
}

/**
 * Visibility (R7, `discoveryWhere`) for these kinds, the base parts, every group except those in `omit`, and `extra`
 * (the text match). Leaving out `kinds` also widens visibility to every kind (the kinds facet counts rented rentals).
 */
export function whereSql(
  parts: FilterParts,
  kinds: readonly ListingKind[],
  extra: Array<SQL | null>,
  omit: readonly FacetGroup[] = [],
  withRadius = true,
): SQL {
  const conds: SQL[] = [discoveryWhere(listings, { kinds: omit.includes('kinds') ? [] : kinds }), ...parts.base];
  if (withRadius && parts.radius) conds.push(parts.radius);
  for (const [group, cond] of parts.groups) if (!omit.includes(group)) conds.push(cond);
  for (const e of extra) if (e) conds.push(e);
  return and(...conds)!;
}
