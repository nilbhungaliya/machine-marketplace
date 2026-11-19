import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import type { CatalogLevel, Fitment, ListingKind, PriceModel, RentalTerms } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { brands, conditions, industrialAreas, listingRentals, machineModels, units } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { resolveSides, type EffectiveSides } from '../catalog/side-settings.js';
import { areasForPincode } from '../locations/industrial-areas.service.js';
import { pincodeDistrict } from '../locations/pincode.service.js';
import type { BusinessRow } from './locks.js';
import { refreshListingSearch } from '../discovery/search-text.js';

// Validation helpers for listing writes (F2 spec §4, §7.3; plan Tasks 6–7).
//
// Catalogue rows a write references are read `FOR KEY SHARE` inside the write's transaction **before** they are
// validated (Batch 1 review item 1). The catalogue guards (`listing-uses.ts`: move / delete a node, brand or model,
// lower a unit's decimals) lock the row `FOR UPDATE` first, so the write waits for the guard's transaction and then
// validates the state the guard left (a moved model, fewer decimals); a guard that starts after the write's lock waits
// for the write to commit and then sees its listing.

type Conn = Db | Tx;

const invalid = (code: string, message: string, details?: Record<string, unknown>) => new ValidationError(message, details, code);

/** Two values are the same after `undefined` is read as null. */
export function same(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a ?? null, b ?? null);
}

// ─── Category ───

export interface ListingNode extends EffectiveSides {
  id: string;
  level: CatalogLevel;
  /** The node and every ancestor are active. */
  chainActive: boolean;
  /** Names from the machine category down to the node. */
  path: string[];
}

/**
 * A category node with its chain: level, whether the whole chain is active, effective side settings (`resolveSides`
 * folded from the root) and the names from the root down. `lock` first takes `FOR KEY SHARE` on the node, so a
 * catalogue guard holding it `FOR UPDATE` (a move, a delete) finishes first and the chain read after it is the
 * post-move one. Null for an unknown id.
 */
export async function loadNode(conn: Conn, nodeId: string, opts: { lock?: boolean } = {}): Promise<ListingNode | null> {
  if (opts.lock) await conn.execute(sql`SELECT id FROM categories WHERE id = ${nodeId} FOR KEY SHARE`);
  const { rows } = await conn.execute<{
    id: string;
    level: CatalogLevel;
    name: string;
    is_active: boolean;
    has_sides: boolean | null;
    side_convention: string | null;
  }>(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, level, name, is_active, has_sides, side_convention, 0 AS depth FROM categories WHERE id = ${nodeId}
      UNION ALL
      SELECT c.id, c.parent_id, c.level, c.name, c.is_active, c.has_sides, c.side_convention, up.depth + 1
      FROM categories c JOIN up ON c.id = up.parent_id
    )
    SELECT id, level, name, is_active, has_sides, side_convention FROM up ORDER BY depth DESC
  `);
  if (rows.length === 0) return null;
  let sides: EffectiveSides | null = null;
  for (const r of rows) sides = resolveSides({ hasSides: r.has_sides, sideConvention: r.side_convention }, sides);
  const node = rows[rows.length - 1]!;
  return {
    id: node.id,
    level: node.level,
    chainActive: rows.every((r) => r.is_active),
    path: rows.map((r) => r.name),
    ...sides!,
  };
}

/** The template kind of a listing kind: parts use part groups, machines and rentals machine types. */
export const templateKindOf = (kind: ListingKind) => (kind === 'part' ? 'part' : 'machine') as 'part' | 'machine';

/**
 * A category a listing may move to (§4.2): a part group for parts, a machine type for machines and rentals, active with
 * active ancestors; locked `FOR KEY SHARE`. Else `400 CATEGORY_INVALID`.
 */
export async function validateCategory(tx: Tx, nodeId: string, kind: ListingKind): Promise<ListingNode> {
  const node = await loadNode(tx, nodeId, { lock: true });
  const level: CatalogLevel = kind === 'part' ? 'part_group' : 'machine_type';
  if (!node || node.level !== level || !node.chainActive) {
    throw invalid('CATEGORY_INVALID', kind === 'part' ? 'Pick an active part group' : 'Pick an active machine type');
  }
  return node;
}

// ─── Brands, models, units, conditions ───

/** A brand a part listing may name as its part brand (§4.3): active, `makes_parts`. Else `400 BRAND_INVALID`. */
export async function validatePartBrand(tx: Tx, brandId: string): Promise<void> {
  const [b] = await tx.select({ isActive: brands.isActive, makesParts: brands.makesParts }).from(brands).where(eq(brands.id, brandId)).for('key share');
  if (!b || !b.isActive || !b.makesParts) throw invalid('BRAND_INVALID', 'Pick an active brand that makes parts');
}

/** A machine make (§4.4): active, `makes_machines`. Else `400 BRAND_INVALID`. */
export async function validateMachineBrand(tx: Tx, brandId: string): Promise<void> {
  const [b] = await tx
    .select({ isActive: brands.isActive, makesMachines: brands.makesMachines })
    .from(brands)
    .where(eq(brands.id, brandId))
    .for('key share');
  if (!b || !b.isActive || !b.makesMachines) throw invalid('BRAND_INVALID', 'Pick an active machine brand');
}

/** Whether a model is active, of the brand and of the machine type; the row is locked `FOR KEY SHARE` first. */
async function modelFits(tx: Tx, modelId: string, brandId: string | null, machineTypeId: string | null): Promise<boolean> {
  const [m] = await tx
    .select({ isActive: machineModels.isActive, brandId: machineModels.brandId, machineTypeId: machineModels.machineTypeId })
    .from(machineModels)
    .where(eq(machineModels.id, modelId))
    .for('key share');
  return !!m && m.isActive && m.brandId === brandId && m.machineTypeId === machineTypeId;
}

/** Locks catalogue rows `FOR KEY SHARE` (ids sorted) and returns them. */
async function lockBrands(tx: Tx, ids: string[]) {
  if (ids.length === 0) return [];
  return tx
    .select({ id: brands.id, isActive: brands.isActive, makesMachines: brands.makesMachines })
    .from(brands)
    .where(inArray(brands.id, [...new Set(ids)].sort()))
    .orderBy(brands.id)
    .for('key share');
}

async function lockModels(tx: Tx, ids: string[]) {
  if (ids.length === 0) return [];
  return tx
    .select({ id: machineModels.id, isActive: machineModels.isActive, brandId: machineModels.brandId })
    .from(machineModels)
    .where(inArray(machineModels.id, [...new Set(ids)].sort()))
    .orderBy(machineModels.id)
    .for('key share');
}

export type UnitRow = { id: string; decimals: number; isActive: boolean; isMachineUnit: boolean };

/** The unit, locked `FOR KEY SHARE` (a guard lowering its decimals finishes first); null for an unknown id. */
export async function lockUnit(tx: Tx, unitId: string): Promise<UnitRow | null> {
  const [u] = await tx
    .select({ id: units.id, decimals: units.decimals, isActive: units.isActive, isMachineUnit: units.isMachineUnit })
    .from(units)
    .where(eq(units.id, unitId))
    .for('key share');
  return u ?? null;
}

/** A part's unit (§4.2): an active unit from master data. Else `400 VALIDATION_ERROR` (`details.field = unitId`). */
export async function validateUnit(tx: Tx, unitId: string): Promise<UnitRow> {
  const u = await lockUnit(tx, unitId);
  if (!u || !u.isActive) throw new ValidationError('Pick an active unit', { field: 'unitId' });
  return u;
}

/** An active condition (§4.2). Else `400 VALIDATION_ERROR` (`details.field = conditionId`). */
export async function validateCondition(tx: Tx, conditionId: string): Promise<void> {
  const [c] = await tx.select({ isActive: conditions.isActive }).from(conditions).where(eq(conditions.id, conditionId));
  if (!c || !c.isActive) throw new ValidationError('Pick an active condition', { field: 'conditionId' });
}

// ─── Quantities ───

const decimalsOf = (value: string): number => (value.includes('.') ? value.split('.')[1]!.replace(/0+$/, '').length : 0);

/**
 * Quantity and min order (§4.2, §4.3): no more decimals than the unit allows (`400 UNIT_DECIMALS`), machines a whole
 * number 1–1000, min order ≤ quantity (`400 MIN_ORDER_ABOVE_QUANTITY`). Format, > 0 and ≤ 1 000 000 are the route's.
 */
export function validateQuantities(
  kind: ListingKind,
  unit: Pick<UnitRow, 'decimals'> | null,
  quantity: string | null,
  minOrder: string | null,
): void {
  for (const [field, value] of [['quantity', quantity], ['minOrderQty', minOrder]] as const) {
    if (value !== null && unit && decimalsOf(value) > unit.decimals) {
      throw invalid('UNIT_DECIMALS', unit.decimals === 0 ? 'Use a whole number for this unit' : `Use at most ${unit.decimals} decimals`, { field });
    }
  }
  if (kind !== 'part' && quantity !== null) {
    const n = Number(quantity);
    if (!Number.isInteger(n)) throw invalid('UNIT_DECIMALS', 'Use a whole number of machines', { field: 'quantity' });
    if (n < 1 || n > 1000) throw new ValidationError('List 1 to 1000 machines', { field: 'quantity' });
  }
  if (quantity !== null && minOrder !== null && Number(minOrder) > Number(quantity)) {
    throw invalid('MIN_ORDER_ABOVE_QUANTITY', "The minimum order can't be more than the quantity");
  }
}

// ─── Price ───

export interface PriceFields {
  priceModel: PriceModel | null;
  pricePaise: number | null;
  gstMode: 'included' | 'extra' | null;
}

/** The price after a patch (§4.6): the price is cleared when the model is (or becomes) `on_request`. */
export function validatePrice(stored: PriceFields, patch: Partial<PriceFields>): PriceFields {
  const priceModel = patch.priceModel !== undefined ? patch.priceModel : stored.priceModel;
  const pricePaise = priceModel === 'on_request' ? null : patch.pricePaise !== undefined ? patch.pricePaise : stored.pricePaise;
  const gstMode = patch.gstMode !== undefined ? patch.gstMode : stored.gstMode;
  return { priceModel, pricePaise, gstMode };
}

// ─── Fitments ───

export type FitmentInput = Pick<Fitment, 'brandId' | 'modelId' | 'modelOther' | 'yearFrom' | 'yearTo' | 'note'>;
export type StoredFitment = FitmentInput & { source: 'seller' | 'admin' };

const fitmentKey = (f: FitmentInput): string =>
  JSON.stringify([f.brandId, f.modelId ?? null, f.modelOther ?? null, f.yearFrom ?? null, f.yearTo ?? null, f.note ?? null]);

/** Whether two fitment lists differ (order counts: the seller's order is shown). */
export function fitmentsDiffer(a: FitmentInput[], b: FitmentInput[]): boolean {
  return a.length !== b.length || a.some((f, i) => fitmentKey(f) !== fitmentKey(b[i]!));
}

/**
 * Fitment rows (§4.3, R37): a catalogue machine brand (active, `makes_machines`); a model optional — active, of that
 * brand, of any machine type — or "Other" text, not both; years 1950 … next year, from ≤ to. `400 FITMENT_INVALID`
 * with `details.index`. Rows equal to a stored row (brand, model, other, years,
 * note) keep their `source` and, unless `checkAll` (a draft or rejected listing), are grandfathered; the others are
 * checked and become `seller` rows.
 */
export async function validateFitments(
  tx: Tx,
  rows: FitmentInput[],
  stored: StoredFitment[],
  opts: { checkAll: boolean },
): Promise<StoredFitment[]> {
  const storedByKey = new Map<string, StoredFitment[]>();
  for (const s of stored) storedByKey.set(fitmentKey(s), [...(storedByKey.get(fitmentKey(s)) ?? []), s]);
  const kept: Array<StoredFitment | null> = rows.map((r) => storedByKey.get(fitmentKey(r))?.shift() ?? null);

  const toCheck = rows.map((r, i) => ({ r, i })).filter(({ i }) => opts.checkAll || kept[i] === null);
  const brandRows = new Map((await lockBrands(tx, toCheck.map(({ r }) => r.brandId))).map((b) => [b.id, b]));
  const modelRows = new Map((await lockModels(tx, toCheck.flatMap(({ r }) => (r.modelId ? [r.modelId] : [])))).map((m) => [m.id, m]));
  const nextYear = new Date().getFullYear() + 1;

  for (const { r, i } of toCheck) {
    const bad = (message: string) => invalid('FITMENT_INVALID', message, { index: i });
    const brand = brandRows.get(r.brandId);
    if (!brand || !brand.isActive || !brand.makesMachines) throw bad('Pick an active machine brand');
    if (r.modelId && r.modelOther) throw bad('Pick a model or type one, not both');
    if (r.modelId) {
      const model = modelRows.get(r.modelId);
      if (!model || !model.isActive || model.brandId !== r.brandId) throw bad("That model isn't one of this brand's");
    }
    for (const y of [r.yearFrom, r.yearTo]) {
      if (y != null && (y < 1950 || y > nextYear)) throw bad(`Years run from 1950 to ${nextYear}`);
    }
    if (r.yearFrom != null && r.yearTo != null && r.yearFrom > r.yearTo) throw bad('The first year comes before the last');
  }
  return rows.map((r, i) => ({
    brandId: r.brandId,
    modelId: r.modelId ?? null,
    modelOther: r.modelOther ?? null,
    yearFrom: r.yearFrom ?? null,
    yearTo: r.yearTo ?? null,
    note: r.note ?? null,
    source: kept[i]?.source ?? 'seller',
  }));
}

// ─── Machine ───

export interface MachineColumns {
  brandId: string | null;
  brandOther: string | null;
  modelId: string | null;
  modelOther: string | null;
  year: number | null;
  hoursRun: number | null;
  serialNumber: string | null;
  underPower: boolean;
  inspectionByAppointment: boolean;
  reasonForSale: string | null;
}

export type MachinePatch = Partial<MachineColumns>;

/**
 * The machine row after a patch (§4.4, R18). Make: a catalogue brand (active, `makes_machines`) or "Other" text —
 * setting one clears the other, both → `400 BRAND_INVALID`. Model: an active model of that brand **and of the
 * listing's machine type**, or "Other" text (`400 MODEL_INVALID`). `check(field)` says whether a sent field is
 * validated (every sent field on a draft, only changed ones otherwise). A catalogue model left over from another make
 * or machine type is dropped.
 */
export async function validateMachine(
  tx: Tx,
  stored: MachineColumns,
  patch: MachinePatch,
  ctx: { machineTypeId: string | null; categoryChanged: boolean; loose: boolean },
): Promise<MachineColumns> {
  const next: MachineColumns = { ...stored };
  for (const key of Object.keys(patch) as Array<keyof MachineColumns>) {
    if (patch[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = patch[key];
  }
  if (patch.brandId != null && patch.brandOther === undefined) next.brandOther = null;
  if (patch.brandOther != null && patch.brandId === undefined) next.brandId = null;
  if (next.brandId && next.brandOther) throw invalid('BRAND_INVALID', 'Pick a make or type one, not both');
  if (patch.modelId != null && patch.modelOther === undefined) next.modelOther = null;
  if (patch.modelOther != null && patch.modelId === undefined) next.modelId = null;
  if (next.modelId && next.modelOther) throw invalid('MODEL_INVALID', 'Pick a model or type one, not both');

  const brandChanged = next.brandId !== stored.brandId;
  if (patch.brandId != null && (ctx.loose || brandChanged)) await validateMachineBrand(tx, patch.brandId);

  if (next.modelId) {
    const sent = patch.modelId != null && (ctx.loose || patch.modelId !== stored.modelId);
    if (sent) {
      if (!(await modelFits(tx, next.modelId, next.brandId, ctx.machineTypeId))) {
        throw invalid('MODEL_INVALID', "Pick an active model of this make and machine type");
      }
    } else if ((brandChanged || ctx.categoryChanged) && !(await modelFits(tx, next.modelId, next.brandId, ctx.machineTypeId))) {
      next.modelId = null;
    }
  }
  return next;
}

// ─── Rental ───

export type RentalColumns = Omit<typeof listingRentals.$inferSelect, 'listingId'>;
export type RentalPatch = Partial<RentalTerms>;

/** Today in India, `YYYY-MM-DD`. */
export function todayInIndia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/**
 * The rental row after a patch (§4.5): a minimum duration comes with its period; the operator rate is kept only for an
 * `optional` or `mandatory` operator; `available_from` is today or later when set or changed (a passed date that isn't
 * touched is grandfathered). Field types and ranges are the route's.
 */
export function validateRental(stored: RentalColumns, patch: RentalPatch): RentalColumns {
  const next: RentalColumns = { ...stored };
  for (const key of Object.keys(patch) as Array<keyof RentalColumns>) {
    if (patch[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = patch[key];
  }
  if (next.operator !== 'optional' && next.operator !== 'mandatory') next.operatorRateDayPaise = null;
  if ((next.minDuration == null) !== (next.minDurationPeriod == null)) {
    throw new ValidationError('Give the minimum with its period', { field: 'rental.minDuration' });
  }
  if (patch.availableFrom != null && patch.availableFrom !== stored.availableFrom && patch.availableFrom < todayInIndia()) {
    throw new ValidationError('Pick today or a later date', { field: 'rental.availableFrom' });
  }
  return next;
}

// ─── Location ───

/** The centroid of a pincode's post offices (`pincode_offices.point`), or NULL (§4.7). `pincode` is a value or SQL. */
export function centroidSql(pincode: string | SQL | null): SQL {
  if (pincode === null) return sql`NULL::geography`;
  return sql`(SELECT ST_Centroid(ST_Collect(po.point::geometry))::geography FROM pincode_offices po WHERE po.pincode = ${pincode} AND po.point IS NOT NULL)`;
}

export type LocationInput =
  | { source: 'business' }
  | {
      source: 'godown';
      pincode: string;
      city: string;
      state: string;
      industrialAreaId?: string | null;
      industrialAreaOther?: string | null;
      addressLine?: string | null;
      lat?: number | null;
      lng?: number | null;
    };

export interface LocationColumns {
  locationSource: 'business' | 'godown';
  pincode: string | null;
  city: string | null;
  state: string | null;
  industrialAreaId: string | null;
  industrialAreaOther: string | null;
  addressLine: string | null;
  point: SQL;
}

/** The business's location as a business-sourced listing copies it: its pin, else its pincode's centroid (R19, I8). */
export function businessLocation(b: BusinessRow): LocationColumns {
  return {
    locationSource: 'business',
    pincode: b.pincode,
    city: b.city,
    state: b.state,
    industrialAreaId: b.industrialAreaId,
    industrialAreaOther: b.industrialAreaOther,
    addressLine: null,
    point: sql`COALESCE((SELECT location FROM businesses WHERE id = ${b.id}), ${centroidSql(b.pincode)})`,
  };
}

/** True when `areaId` is a listed area of the pincode's district and state, inactive ones included. */
async function areaOfPincode(tx: Tx, areaId: string, pincode: string): Promise<boolean> {
  const where = await pincodeDistrict(tx, pincode);
  if (!where) return false;
  const [row] = await tx
    .select({ id: industrialAreas.id })
    .from(industrialAreas)
    .where(and(eq(industrialAreas.id, areaId), sql`lower(${industrialAreas.city}) = lower(${where.city})`, eq(industrialAreas.state, where.state)));
  return !!row;
}

/**
 * A listing's location (§4.7). `business`: copied from the business. `godown`: pincode, city and state as typed; an
 * optional industrial area — an active area of the pincode's district and state (`400 AREA_MISMATCH`), or the area the
 * listing already has (kept after an admin deactivates it, as F1) — or "Other" text; an optional private address line;
 * the point is the pin, else the pincode's centroid.
 */
export async function validateLocation(
  tx: Tx,
  input: LocationInput,
  ctx: { business: BusinessRow; currentAreaId: string | null },
): Promise<LocationColumns> {
  if (input.source === 'business') return businessLocation(ctx.business);
  const areaId = input.industrialAreaId ?? null;
  if (areaId) {
    const listed = (await areasForPincode(tx, input.pincode)).some((a) => a.id === areaId);
    const kept = !listed && areaId === ctx.currentAreaId && (await areaOfPincode(tx, areaId, input.pincode));
    if (!listed && !kept) throw invalid('AREA_MISMATCH', "That industrial area isn't in this pincode's district");
  }
  const hasPin = input.lat != null && input.lng != null;
  return {
    locationSource: 'godown',
    pincode: input.pincode,
    city: input.city,
    state: input.state,
    industrialAreaId: areaId,
    industrialAreaOther: areaId ? null : (input.industrialAreaOther?.trim() || null),
    addressLine: input.addressLine?.trim() || null,
    point: hasPin ? sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography` : centroidSql(input.pincode),
  };
}

/**
 * The business location sync (§4.7, R19): every non-removed `business`-source listing of the business takes the
 * business's new location and point (pin, else the pincode's centroid); `version + 1`, `refreshed_at` unchanged (it
 * isn't a listing edit). Run in `setMyLocation`'s transaction, after it has updated (and locked) the business row, so
 * the listings are locked after the business, as every listing write does. Returns how many listings moved.
 */
export async function syncBusinessListings(tx: Tx, businessId: string): Promise<number> {
  const result = await tx.execute(sql`
    UPDATE listings AS l
    SET pincode = b.pincode,
        city = b.city,
        state = b.state,
        industrial_area_id = b.industrial_area_id,
        industrial_area_other = b.industrial_area_other,
        address_line = NULL,
        point = COALESCE(b.location, ${centroidSql(sql`b.pincode`)}),
        version = l.version + 1,
        updated_at = now()
    FROM businesses AS b
    WHERE b.id = ${businessId}
      AND l.business_id = b.id
      AND l.location_source = 'business'
      AND l.status <> 'removed'
    RETURNING l.id
  `);
  // F4 + F5 §5.2: the location (and so the search point) changed.
  const ids = (result.rows as Array<{ id: string }>).map((r) => r.id);
  await refreshListingSearch(tx, ids);
  return result.rowCount ?? 0;
}
