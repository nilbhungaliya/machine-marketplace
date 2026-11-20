import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  PART_REQUEST_AUDIENCES,
  PART_REQUEST_LIMITS,
  PART_REQUEST_REACHES,
  PART_SIDES,
  fitsUnitDecimals,
  normalizePartName,
  normalizePartNumber,
  partNumberBase,
  type PartRequestInput,
  type PartRequestPatch,
  type PartSide,
  type Specs,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { brands, conditions, machineModels, partRequestFitments, units, users } from '../../db/schema.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { checkSpecs, isRealDate, isStorableText } from '../../lib/spec-check.js';
import { onboardingForUser } from '../business/profile.service.js';
import { loadTemplate } from '../catalog/read.service.js';
import { looksLikeScam } from '../chat/scam-patterns.js';
import { loadNode, todayInIndia } from '../listings/listing-validate.service.js';
import { getSettings } from '../settings.service.js';
import { machineCategoryOf, requestCategoryNode } from './categories.js';
import type { PartRequestRow } from './locks.js';

// What a buyer types into the requirement form (spec §5.1, §5.2, R1; plan A1-1; textile
// `services/requirements/requirement-input.ts`): the Zod bodies and `resolveRequestFields`, which checks every field
// against the catalogue and settings and returns the columns to write. Every refusal is a typed 400 (or 409 for a
// category moved to another machine category, F2's `CATEGORY_LOCKED`).

type Conn = Db | Tx;

const invalid = (code: string, message: string, details?: Record<string, unknown>) => new ValidationError(message, details, code);

// ─── Zod bodies ───

const uuid = z.string().uuid();
const storable = (s: string) => isStorableText(s);
/** Trimmed text up to `max`; `''` and null clear it. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(storable, 'contains characters that cannot be saved')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Decimal string, > 0, ≤ 1 000 000, at most 3 decimals (as F2's listing quantity). */
const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,3})?$/, 'must be a number with at most 3 decimals')
  .refine((v) => Number(v) > 0 && Number(v) <= 1_000_000, 'must be more than 0 and at most 1 000 000');
const year = z.number().int().min(1900).max(2100);
const specValue = z.union([z.string().max(1000), z.array(z.string().max(200)).max(100), z.number()]);
const specs = z.record(z.string().min(1).max(64), specValue).refine((s) => Object.keys(s).length <= 200, 'too many fields');

const fitSchema = z
  .object({ brandId: uuid, modelId: uuid.nullable().optional(), yearFrom: year.nullable().optional(), yearTo: year.nullable().optional() })
  .strict();

const fields = {
  categoryId: uuid,
  name: z
    .string()
    .trim()
    .min(PART_REQUEST_LIMITS.nameMin)
    .max(PART_REQUEST_LIMITS.nameMax)
    .refine(storable, 'contains characters that cannot be saved'),
  partNumber: optText(60),
  side: z.enum(PART_SIDES).nullable().optional(),
  fits: z.array(fitSchema).max(PART_REQUEST_LIMITS.fitsMax).optional(),
  specs: specs.optional(),
  quantity,
  unitId: uuid.nullable().optional(),
  conditionIds: z.array(uuid).max(10).optional(),
  budgetPerUnitPaise: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  budgetVisible: z.boolean().optional(),
  neededBy: z.string().refine(isRealDate, 'must be a date (YYYY-MM-DD)').nullable().optional(),
  urgent: z.boolean().optional(),
  reach: z.enum(PART_REQUEST_REACHES),
  audience: z.enum(PART_REQUEST_AUDIENCES),
  photoKeys: z.array(z.string().max(200)).max(PART_REQUEST_LIMITS.photosMax).optional(),
  note: optText(PART_REQUEST_LIMITS.noteMax),
};

/**
 * `POST /part-requests` (strict). `quantity` may be left out for a machine (it defaults to 1); a part needs it
 * (`resolveRequestFields`).
 */
export const partRequestInputSchema = z
  .object({
    kind: z.enum(['part', 'machine']),
    ...fields,
    quantity: quantity.optional(),
    validityDays: z.number().int(),
  })
  .strict();

/** `PATCH /part-requests/:id` (strict): `version` plus any field but `kind` (`KIND_IMMUTABLE`) and `validityDays`. */
export const partRequestPatchSchema = z
  .object({
    version: z.number().int().min(1),
    categoryId: fields.categoryId.optional(),
    name: fields.name.optional(),
    partNumber: fields.partNumber,
    side: fields.side,
    fits: fields.fits,
    specs: fields.specs,
    quantity: quantity.optional(),
    unitId: fields.unitId,
    conditionIds: fields.conditionIds,
    budgetPerUnitPaise: fields.budgetPerUnitPaise,
    budgetVisible: fields.budgetVisible,
    neededBy: fields.neededBy,
    urgent: fields.urgent,
    reach: fields.reach.optional(),
    audience: fields.audience.optional(),
    photoKeys: fields.photoKeys,
    note: fields.note,
  })
  .strict();

export type ParsedPartRequestInput = Omit<PartRequestInput, 'quantity'> & { quantity?: string };

/** Parses a PATCH body: a `kind` key is `400 KIND_IMMUTABLE` (before the strict parse, which would call it unknown). */
export function parsePartRequestPatch(body: unknown): PartRequestPatch {
  if (body !== null && typeof body === 'object' && Object.hasOwn(body, 'kind')) {
    throw invalid('KIND_IMMUTABLE', "A requirement's kind can't change; post a new one", { field: 'kind' });
  }
  return partRequestPatchSchema.parse(body ?? {}) as PartRequestPatch;
}

// ─── Resolve ───

export interface ResolvedFit {
  brandId: string;
  modelId: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

/** The request columns a post or an edit writes (location, ids, status and timestamps are the caller's). */
export interface ResolvedRequestFields {
  /** The request's kind (fixed after posting). */
  kind: 'part' | 'machine';
  values: {
    categoryId: string;
    name: string;
    nameNorm: string;
    partNumber: string | null;
    partNumberNorm: string | null;
    partNumberBase: string | null;
    side: PartSide | null;
    specs: Specs;
    quantity: string;
    unitId: string;
    conditionIds: string[];
    budgetPerUnitPaise: number | null;
    budgetVisible: boolean;
    neededBy: string | null;
    urgent: boolean;
    reach: PartRequestRow['reach'];
    audience: PartRequestRow['audience'];
    note: string | null;
    noteFlagged: boolean;
  };
  /** The fits to store; undefined on an edit that leaves them. */
  fits: ResolvedFit[] | undefined;
  /** Post: the validity days (one of the three settings). */
  validityDays: number | null;
  /** Edit: a matching field changed (§7.1: category, name, part number, side, fits, conditions, reach, audience, quantity / unit). */
  matchingChanged: boolean;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

async function storedFits(conn: Conn, requestId: string): Promise<ResolvedFit[]> {
  return conn
    .select({
      brandId: partRequestFitments.brandId,
      modelId: partRequestFitments.modelId,
      yearFrom: partRequestFitments.yearFrom,
      yearTo: partRequestFitments.yearTo,
    })
    .from(partRequestFitments)
    .where(eq(partRequestFitments.partRequestId, requestId))
    .orderBy(asc(partRequestFitments.sortOrder), asc(partRequestFitments.id));
}

const fitKey = (f: ResolvedFit) => JSON.stringify([f.brandId, f.modelId, f.yearFrom, f.yearTo]);

/**
 * Fits (§5.2): an active brand that makes machines (`BRAND_INVALID`); a model active and of that brand and, for a
 * machine request, of its machine type (`MODEL_INVALID`); years 1950 … next year, from ≤ to (`FITMENT_INVALID`).
 */
async function validateFits(conn: Conn, fits: ResolvedFit[], machineTypeId: string | null): Promise<void> {
  if (fits.length === 0) return;
  const brandIds = [...new Set(fits.map((f) => f.brandId))];
  const modelIds = [...new Set(fits.flatMap((f) => (f.modelId ? [f.modelId] : [])))];
  const brandRows = new Map(
    (await conn.select({ id: brands.id, isActive: brands.isActive, makesMachines: brands.makesMachines }).from(brands).where(inArray(brands.id, brandIds))).map(
      (b) => [b.id, b],
    ),
  );
  const modelRows = new Map(
    (modelIds.length
      ? await conn
          .select({ id: machineModels.id, isActive: machineModels.isActive, brandId: machineModels.brandId, machineTypeId: machineModels.machineTypeId })
          .from(machineModels)
          .where(inArray(machineModels.id, modelIds))
      : []
    ).map((m) => [m.id, m]),
  );
  const nextYear = new Date().getFullYear() + 1;
  fits.forEach((f, index) => {
    const brand = brandRows.get(f.brandId);
    if (!brand || !brand.isActive || !brand.makesMachines) throw invalid('BRAND_INVALID', 'Pick an active machine brand', { index });
    if (f.modelId) {
      const m = modelRows.get(f.modelId);
      const typeOk = machineTypeId === null || m?.machineTypeId === machineTypeId;
      if (!m || !m.isActive || m.brandId !== f.brandId || !typeOk) {
        throw invalid('MODEL_INVALID', "That model isn't one of this brand's", { index });
      }
    }
    for (const y of [f.yearFrom, f.yearTo]) {
      if (y !== null && (y < 1950 || y > nextYear)) throw invalid('FITMENT_INVALID', `Years run from 1950 to ${nextYear}`, { index });
    }
    if (f.yearFrom !== null && f.yearTo !== null && f.yearFrom > f.yearTo) {
      throw invalid('FITMENT_INVALID', 'The first year comes before the last', { index });
    }
  });
}

/** `YYYY-MM-DD` plus `days` (calendar arithmetic in UTC on a date string). */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Specs (§5.1): only on a node at the kind's template level (part group for parts, machine type for machines), checked
 * with `checkSpecs` with `required` errors dropped (every spec may be "any"); `400 SPECS_INVALID` with the field errors.
 */
async function resolveSpecs(
  conn: Conn,
  nodeId: string,
  level: string,
  kind: 'part' | 'machine',
  value: Specs,
  previous: Specs | undefined,
  allowInactive: boolean,
): Promise<Specs> {
  const entries = Object.entries(value).filter(([, v]) => !(v === null || v === '' || (Array.isArray(v) && v.length === 0)));
  if (entries.length === 0) return {};
  const templateLevel = kind === 'part' ? 'part_group' : 'machine_type';
  if (level !== templateLevel) throw invalid('SPECS_INVALID', 'Pick a more specific category to add specifications');
  let template;
  try {
    template = await loadTemplate(conn, nodeId, kind, { includeRetired: true, allowInactive });
  } catch (err) {
    if (err instanceof NotFoundError) throw invalid('SPECS_INVALID', 'Pick a more specific category to add specifications');
    throw err;
  }
  const clean = Object.fromEntries(entries) as Specs;
  const result = checkSpecs(template, clean, previous);
  if (!result.ok) {
    const errors = Object.fromEntries(Object.entries(result.errors).filter(([, code]) => code !== 'required'));
    if (Object.keys(errors).length > 0) throw invalid('SPECS_INVALID', 'Some specifications need fixing', errors);
  }
  return clean;
}

/**
 * Checks a post (`current` null) or an edit (the stored row) and returns the columns to write. Category: a part group
 * or machine type for parts, a machine type for machines, whole chain active (`CATEGORY_INVALID`); an edit may move it
 * only inside its machine category (`409 CATEGORY_LOCKED`). Side: Left / Right / Pair required on a node with sides
 * (`SIDE_REQUIRED`), none otherwise (`SIDE_NOT_ALLOWED`), never `not_applicable`; machines none. Part number: parts
 * only (norm and side-stripped base). Unit: parts an active unit (`UNIT_INVALID`, `UNIT_DECIMALS`), machines the machine
 * unit and quantity 1 by default. Conditions active (`CONDITION_INVALID`). Fits (§5.2). Needed by: today … today + 365
 * (IST). Validity: one of the three settings (`VALIDITY_INVALID`, post only). Only the fields an edit sends (or that a
 * category change affects) are re-checked against the catalogue.
 */
export async function resolveRequestFields(
  conn: Conn,
  input: ParsedPartRequestInput | PartRequestPatch,
  current: PartRequestRow | null,
): Promise<ResolvedRequestFields> {
  const has = <K extends string>(k: K) => Object.hasOwn(input, k) && (input as Record<string, unknown>)[k] !== undefined;
  const post = current === null;
  const kind = post ? (input as ParsedPartRequestInput).kind : current.kind;

  // Category.
  const categoryId = (has('categoryId') ? (input as { categoryId: string }).categoryId : current?.categoryId) as string;
  const categoryChanged = post || categoryId !== current.categoryId;
  let node: { id: string; level: string; hasSides: boolean };
  if (categoryChanged) {
    const n = await requestCategoryNode(conn, categoryId, kind);
    if (!n) throw invalid('CATEGORY_INVALID', kind === 'part' ? 'Pick an active part group or machine type' : 'Pick an active machine type');
    if (!post) {
      const [from, to] = await Promise.all([machineCategoryOf(conn, current.categoryId), machineCategoryOf(conn, categoryId)]);
      if (!from || !to || from.id !== to.id) {
        throw new ConflictError('Keep the requirement in the same machine category; post a new one instead', 'CATEGORY_LOCKED');
      }
    }
    node = n;
  } else {
    const n = await loadNode(conn, categoryId);
    if (!n) throw invalid('CATEGORY_INVALID', 'Pick an active category');
    node = { id: n.id, level: n.level, hasSides: n.effectiveHasSides };
  }

  // Side.
  const sentSide = has('side') || Object.hasOwn(input, 'side');
  let side: PartSide | null = sentSide ? ((input as { side?: PartSide | null }).side ?? null) : (current?.side ?? null);
  if (side === 'not_applicable' && !node.hasSides) side = null;
  if (post || sentSide || categoryChanged) {
    if (kind === 'machine') {
      if (side !== null) throw invalid('SIDE_NOT_ALLOWED', 'A machine has no side', { field: 'side' });
    } else if (node.hasSides) {
      if (side === null || side === 'not_applicable') throw invalid('SIDE_REQUIRED', 'Pick Left, Right or Pair', { field: 'side' });
    } else if (side !== null) {
      throw invalid('SIDE_NOT_ALLOWED', "Parts of this category don't have sides", { field: 'side' });
    }
  }

  // Part number.
  const sentPartNumber = Object.hasOwn(input, 'partNumber') && (input as { partNumber?: unknown }).partNumber !== undefined;
  const partNumber = sentPartNumber ? ((input as { partNumber?: string | null }).partNumber ?? null) : (current?.partNumber ?? null);
  if (kind === 'machine' && partNumber !== null) {
    throw new ValidationError('A machine requirement has no part number', { field: 'partNumber' });
  }
  const partNumberNorm = partNumber ? normalizePartNumber(partNumber) || null : null;

  // Specs.
  let specValues: Specs;
  if (has('specs')) {
    specValues = await resolveSpecs(conn, node.id, node.level, kind, (input as { specs: Specs }).specs, current?.specs, !categoryChanged);
  } else if (current && categoryChanged) {
    // A move keeps only the stored specs that still validate on the new node.
    try {
      specValues = await resolveSpecs(conn, node.id, node.level, kind, current.specs, current.specs, false);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      specValues = {};
    }
  } else {
    specValues = current?.specs ?? {};
  }

  // Unit and quantity.
  let unitId: string;
  let qty: string;
  if (kind === 'machine') {
    if (post) {
      const [u] = await conn
        .select({ id: units.id })
        .from(units)
        .where(and(eq(units.isMachineUnit, true), eq(units.isActive, true)))
        .orderBy(asc(units.sortOrder), asc(units.key))
        .limit(1);
      if (!u) throw new ConflictError('No unit is set up for machines yet', 'NO_MACHINE_UNIT');
      unitId = u.id;
    } else {
      unitId = current.unitId;
    }
    qty = (input as { quantity?: string }).quantity ?? current?.quantity ?? '1';
    if (has('quantity') && !Number.isInteger(Number(qty))) throw invalid('UNIT_DECIMALS', 'Use a whole number of machines', { field: 'quantity' });
  } else {
    const sentUnit = has('unitId');
    unitId = (sentUnit ? (input as { unitId: string }).unitId : current?.unitId) as string;
    if (!unitId) throw invalid('UNIT_INVALID', 'Pick a unit', { field: 'unitId' });
    const sentQty = has('quantity');
    const q = sentQty ? (input as { quantity: string }).quantity : current?.quantity;
    if (!q) throw new ValidationError('Enter the quantity', { field: 'quantity' });
    qty = q;
    if (post || sentUnit || sentQty) {
      const [u] = await conn.select({ isActive: units.isActive, decimals: units.decimals }).from(units).where(eq(units.id, unitId));
      if (sentUnit || post) {
        if (!u || !u.isActive) throw invalid('UNIT_INVALID', 'Pick an active unit', { field: 'unitId' });
      }
      if (u && !fitsUnitDecimals(qty, u.decimals)) {
        throw invalid('UNIT_DECIMALS', u.decimals === 0 ? 'Use a whole number for this unit' : `Use at most ${u.decimals} decimals`, { field: 'quantity' });
      }
    }
  }

  // Conditions.
  let conditionIds = current?.conditionIds ?? [];
  if (has('conditionIds')) {
    conditionIds = [...new Set((input as { conditionIds: string[] }).conditionIds)];
    if (conditionIds.length) {
      const rows = await conn.select({ id: conditions.id, isActive: conditions.isActive }).from(conditions).where(inArray(conditions.id, conditionIds));
      const active = new Set(rows.filter((r) => r.isActive).map((r) => r.id));
      if (conditionIds.some((id) => !active.has(id))) throw invalid('CONDITION_INVALID', 'Pick active conditions', { field: 'conditionIds' });
    }
  }

  // Fits.
  let fits: ResolvedFit[] | undefined;
  let fitsChanged = false;
  const machineTypeId = kind === 'machine' ? node.id : null;
  if (has('fits')) {
    fits = (input as { fits: NonNullable<PartRequestInput['fits']> }).fits.map((f) => ({
      brandId: f.brandId,
      modelId: f.modelId ?? null,
      yearFrom: f.yearFrom ?? null,
      yearTo: f.yearTo ?? null,
    }));
    await validateFits(conn, fits, machineTypeId);
    if (current) {
      const before = await storedFits(conn, current.id);
      fitsChanged = before.length !== fits.length || before.some((f, i) => fitKey(f) !== fitKey(fits![i]!));
    } else {
      fitsChanged = true;
    }
  } else if (post) {
    fits = [];
  } else if (kind === 'machine' && categoryChanged) {
    // A machine request's models must stay of its machine type.
    const before = await storedFits(conn, current.id);
    await validateFits(conn, before, machineTypeId);
  }

  // Needed by.
  let neededBy = current?.neededBy ?? null;
  if (Object.hasOwn(input, 'neededBy') && (input as { neededBy?: unknown }).neededBy !== undefined) {
    neededBy = (input as { neededBy: string | null }).neededBy;
    if (neededBy !== null) {
      const today = todayInIndia();
      if (neededBy < today || neededBy > addDays(today, 365)) {
        throw new ValidationError('Pick a date from today to a year from now', { field: 'neededBy' });
      }
    }
  }

  // Validity (post only; renew owns it after).
  let validityDays: number | null = null;
  if (post) {
    const s = await getSettings(conn);
    const allowed = [s.part_request_validity_days_1, s.part_request_validity_days_2, s.part_request_validity_days_3];
    validityDays = (input as ParsedPartRequestInput).validityDays;
    if (!allowed.includes(validityDays)) throw invalid('VALIDITY_INVALID', 'Pick one of the offered periods', { allowed });
  }

  const pick = <T>(k: string, stored: T | undefined, fallback: T): T =>
    Object.hasOwn(input, k) && (input as Record<string, unknown>)[k] !== undefined ? ((input as Record<string, unknown>)[k] as T) : (stored ?? fallback);

  const name = pick<string>('name', current?.name, '');
  const note = pick<string | null>('note', current?.note, null);
  const reach = pick<PartRequestRow['reach']>('reach', current?.reach, 'radius_200');
  const audience = pick<PartRequestRow['audience']>('audience', current?.audience, 'verified_only');

  const values: ResolvedRequestFields['values'] = {
    categoryId,
    name,
    nameNorm: normalizePartName(name),
    partNumber,
    partNumberNorm,
    partNumberBase: partNumberNorm ? partNumberBase(partNumberNorm, side) : null,
    side,
    specs: specValues,
    quantity: qty,
    unitId,
    conditionIds,
    budgetPerUnitPaise: pick<number | null>('budgetPerUnitPaise', current?.budgetPerUnitPaise, null),
    budgetVisible: pick<boolean>('budgetVisible', current?.budgetVisible, false),
    neededBy,
    urgent: pick<boolean>('urgent', current?.urgent, false),
    reach,
    audience,
    note,
    noteFlagged: note ? looksLikeScam(note) : false,
  };

  const matchingChanged =
    !current ||
    categoryChanged ||
    values.name !== current.name ||
    values.partNumberNorm !== current.partNumberNorm ||
    values.side !== current.side ||
    fitsChanged ||
    !sameSet(values.conditionIds, current.conditionIds) ||
    values.reach !== current.reach ||
    values.audience !== current.audience ||
    Number(values.quantity) !== Number(current.quantity) ||
    values.unitId !== current.unitId;

  return { kind, values, fits, validityDays, matchingChanged };
}

/** The open-requests and daily-posts numbers for a business (plan D8). `verified` = GST in `verification_levels`. */
export async function requestLimitState(
  conn: Conn,
  businessId: string,
): Promise<{ openLimit: number; openCount: number; postsPerDay: number; postsToday: number }> {
  const s = await getSettings(conn);
  const { rows } = await conn.execute<{ verified: boolean; open: number; today: number }>(sql`
    SELECT (SELECT b.verification_levels ? 'gst' FROM businesses b WHERE b.id = ${businessId}) AS verified,
           (SELECT count(*)::int FROM part_requests r WHERE r.business_id = ${businessId} AND r.status = 'active') AS open,
           (SELECT count(*)::int FROM part_requests r WHERE r.business_id = ${businessId}
               AND r.created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')) AS today`);
  const r = rows[0]!;
  return {
    openLimit: r.verified ? s.part_request_open_limit_verified : s.part_request_open_limit_unverified,
    openCount: Number(r.open),
    postsPerDay: s.part_request_posts_per_day,
    postsToday: Number(r.today),
  };
}

/**
 * Every F8 write but close, fulfil, edit and read (§6, review 6): `requireUser` doesn't check onboarding, so the
 * service does (`409 ONBOARDING_INCOMPLETE`, as `createListing`). Returns the user's business id.
 */
export async function assertOnboarded(conn: Conn, user: { userId: string }): Promise<string> {
  const incomplete = () => new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
  const [u] = await conn.select({ name: users.name, businessId: users.businessId }).from(users).where(eq(users.id, user.userId));
  if (!u?.businessId) throw incomplete();
  if ((await onboardingForUser(conn, u)) !== 'done') throw incomplete();
  return u.businessId;
}
