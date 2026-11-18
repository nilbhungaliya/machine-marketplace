import { and, asc, eq, max, ne, sql } from 'drizzle-orm';
import { CATALOG_KEY_REGEX, type Brand, type MachineModel } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { brands, categories, machineModels } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../lib/pg-errors.js';
import { slugify } from '../../lib/slug.js';
import { writeAudit } from '../audit.service.js';
import { toBrand, toModel } from './brand-read.service.js';
import { assertExactSet } from './reorder.js';

// Admin writes on brands and machine models (spec §6). Keys never change. A model's name is unique per brand and machine
// type ignoring case: checked before the write for a clear error, and backed by machine_models_brand_type_name_uq for
// races. Each function runs in one transaction and writes one audit_log row with it.
//
// Locks: a write that depends on a brand's flags or models takes the brand row (`FOR SHARE` to add or move a model in,
// `FOR UPDATE` to change the brand or delete it), so "makes machines" can't be turned off, nor the brand deleted, while
// a model is being added to it. Model writes lock the model first, then the brand: nothing locks in the other order.

type BrandRow = typeof brands.$inferSelect;
type ModelRow = typeof machineModels.$inferSelect;

const BRAND_KEY_CONSTRAINT = 'brands_key_unique';
const BRAND_SLUG_CONSTRAINT = 'brands_slug_unique';
const MODEL_KEY_CONSTRAINT = 'machine_models_brand_key_uq';
const MODEL_NAME_INDEX = 'machine_models_brand_type_name_uq';

function fieldInvalid(message: string): ValidationError {
  return new ValidationError(message, undefined, 'FIELD_INVALID');
}

const brandKeyTaken = () => new ConflictError('Another brand already uses this key', 'KEY_TAKEN');
const modelKeyTaken = () => new ConflictError('This brand already has a model with this key', 'KEY_TAKEN');
const nameTaken = () => new ConflictError('This brand already has a model with this name for this machine type', 'NAME_TAKEN');
const brandInUse = (message: string) => new ConflictError(message, 'BRAND_IN_USE');

/** The unique indexes are the race backstop for keys, slugs and model names. */
async function mapUniqueViolations<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isUniqueViolation(err, BRAND_KEY_CONSTRAINT)) throw brandKeyTaken();
    if (isUniqueViolation(err, BRAND_SLUG_CONSTRAINT)) throw new ConflictError('Another brand already uses this slug', 'SLUG_TAKEN');
    if (isUniqueViolation(err, MODEL_KEY_CONSTRAINT)) throw modelKeyTaken();
    if (isUniqueViolation(err, MODEL_NAME_INDEX)) throw nameTaken();
    throw err;
  }
}

function checkKey(key: string): void {
  if (!CATALOG_KEY_REGEX.test(key)) throw new ValidationError('Key must be snake_case: a letter, then 1–39 of a-z, 0-9, _');
}

function checkFlags(flags: { makesMachines: boolean; makesParts: boolean }): void {
  if (!flags.makesMachines && !flags.makesParts) throw fieldInvalid('A brand makes machines, parts or both');
}

/** Next sortOrder at the end of a list: 0 for an empty list. */
function nextOrder(last: { value: number | null } | undefined): number {
  return last?.value === null || last?.value === undefined ? 0 : last.value + 1;
}

async function lockBrand(tx: Tx, id: string, strength: 'update' | 'share'): Promise<BrandRow> {
  const [row] = await tx.select().from(brands).where(eq(brands.id, id)).for(strength);
  if (!row) throw new NotFoundError('Brand');
  return row;
}

async function lockModel(tx: Tx, id: string): Promise<ModelRow> {
  const [row] = await tx.select().from(machineModels).where(eq(machineModels.id, id)).for('update');
  if (!row) throw new NotFoundError('Model');
  return row;
}

async function hasModels(tx: Tx, brandId: string): Promise<boolean> {
  const [row] = await tx.select({ id: machineModels.id }).from(machineModels).where(eq(machineModels.brandId, brandId)).limit(1);
  return row !== undefined;
}

/** Models attach to machine types only (not categories or part groups). An unknown id is not a machine type either. */
async function assertMachineType(tx: Tx, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.level, 'machine_type')));
  if (!row) throw new ValidationError('Models belong to a machine type', undefined, 'NOT_A_MACHINE_TYPE');
}

function assertMachineMaker(brand: BrandRow): void {
  if (!brand.makesMachines) throw new ValidationError('This brand does not make machines', undefined, 'BRAND_NOT_MACHINE_MAKER');
}

/** NAME_TAKEN when another model of the brand and machine type has this name, ignoring case. */
async function assertNameFree(tx: Tx, where: { brandId: string; machineTypeId: string; name: string; exceptId?: string }): Promise<void> {
  const [clash] = await tx
    .select({ id: machineModels.id })
    .from(machineModels)
    .where(
      and(
        eq(machineModels.brandId, where.brandId),
        eq(machineModels.machineTypeId, where.machineTypeId),
        sql`lower(${machineModels.name}) = lower(${where.name})`,
        where.exceptId ? ne(machineModels.id, where.exceptId) : undefined,
      ),
    )
    .limit(1);
  if (clash) throw nameTaken();
}

async function nextModelOrder(tx: Tx, brandId: string): Promise<number> {
  const [last] = await tx.select({ value: max(machineModels.sortOrder) }).from(machineModels).where(eq(machineModels.brandId, brandId));
  return nextOrder(last);
}

// ---- Brands ----

export interface CreateBrandInput {
  key: string;
  name: string;
  /** Defaults to slugify(name). */
  slug?: string;
  makesMachines: boolean;
  makesParts: boolean;
}

/** The new brand goes last. */
export async function createBrand(db: Db, adminId: string, input: CreateBrandInput): Promise<Brand> {
  checkKey(input.key);
  checkFlags(input);
  const slug = input.slug ?? slugify(input.name);
  if (!slug) throw new ValidationError('The name gives an empty slug; pass a slug');

  return mapUniqueViolations(() =>
    db.transaction(async (tx) => {
      const [last] = await tx.select({ value: max(brands.sortOrder) }).from(brands);
      const [row] = await tx
        .insert(brands)
        .values({
          key: input.key,
          name: input.name,
          slug,
          makesMachines: input.makesMachines,
          makesParts: input.makesParts,
          sortOrder: nextOrder(last),
        })
        .returning();
      const brand = toBrand(row!);
      await writeAudit(tx, { adminId, action: 'brand.create', entityType: 'brand', entityId: brand.id, before: null, after: brand });
      return brand;
    }),
  );
}

export interface UpdateBrandPatch {
  name?: string;
  slug?: string;
  makesMachines?: boolean;
  makesParts?: boolean;
  needsReview?: boolean;
  isActive?: boolean;
}

/** "Makes machines" can't be turned off while the brand has models; at least one flag stays on. */
export async function updateBrand(db: Db, adminId: string, id: string, patch: UpdateBrandPatch): Promise<Brand> {
  return mapUniqueViolations(() =>
    db.transaction(async (tx) => {
      const before = await lockBrand(tx, id, 'update');
      checkFlags({ makesMachines: patch.makesMachines ?? before.makesMachines, makesParts: patch.makesParts ?? before.makesParts });
      if (patch.makesMachines === false && before.makesMachines && (await hasModels(tx, id))) {
        throw brandInUse('This brand has machine models; move or delete them first');
      }

      const [after] = await tx
        .update(brands)
        .set({
          name: patch.name,
          slug: patch.slug,
          makesMachines: patch.makesMachines,
          makesParts: patch.makesParts,
          needsReview: patch.needsReview,
          isActive: patch.isActive,
          updatedAt: new Date(),
        })
        .where(eq(brands.id, id))
        .returning();
      await writeAudit(tx, { adminId, action: 'brand.update', entityType: 'brand', entityId: id, before: toBrand(before), after: toBrand(after!) });
      return toBrand(after!);
    }),
  );
}

/** `orderedIds` must be exactly all brands (active and inactive). */
export async function reorderBrands(db: Db, adminId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await tx.select({ id: brands.id }).from(brands).orderBy(asc(brands.sortOrder), asc(brands.name));
    assertExactSet(current, orderedIds, 'brands');

    for (const [index, id] of orderedIds.entries()) {
      await tx.update(brands).set({ sortOrder: index, updatedAt: new Date() }).where(eq(brands.id, id));
    }
    await writeAudit(tx, {
      adminId,
      action: 'brand.reorder',
      entityType: 'brand',
      entityId: null,
      before: current.map((r) => r.id),
      after: orderedIds,
    });
  });
}

/** Deletes a brand only when it has no models; otherwise the admin deactivates it instead. */
export async function deleteBrand(db: Db, adminId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockBrand(tx, id, 'update');
    if (await hasModels(tx, id)) throw brandInUse('This brand has machine models; deactivate it instead');
    // M5: refuse when listings reference this brand (fitment or part brand)
    try {
      await tx.delete(brands).where(eq(brands.id, id));
    } catch (err) {
      // A reference committed after the check above.
      if (isForeignKeyViolation(err)) throw brandInUse('This brand is in use; deactivate it instead');
      throw err;
    }
    await writeAudit(tx, { adminId, action: 'brand.delete', entityType: 'brand', entityId: id, before: toBrand(before), after: null });
  });
}

// ---- Models ----

export interface CreateModelInput {
  brandId: string;
  machineTypeId: string;
  key: string;
  name: string;
}

/** The new model goes last in its brand. */
export async function createModel(db: Db, adminId: string, input: CreateModelInput): Promise<MachineModel> {
  checkKey(input.key);
  return mapUniqueViolations(() =>
    db.transaction(async (tx) => {
      const brand = await lockBrand(tx, input.brandId, 'share');
      assertMachineMaker(brand);
      await assertMachineType(tx, input.machineTypeId);
      await assertNameFree(tx, { brandId: brand.id, machineTypeId: input.machineTypeId, name: input.name });

      const [row] = await tx
        .insert(machineModels)
        .values({
          brandId: brand.id,
          machineTypeId: input.machineTypeId,
          key: input.key,
          name: input.name,
          sortOrder: await nextModelOrder(tx, brand.id),
        })
        .returning();
      const model = toModel(row!);
      await writeAudit(tx, { adminId, action: 'model.create', entityType: 'model', entityId: model.id, before: null, after: model });
      return model;
    }),
  );
}

export interface UpdateModelPatch {
  name?: string;
  needsReview?: boolean;
  isActive?: boolean;
}

export async function updateModel(db: Db, adminId: string, id: string, patch: UpdateModelPatch): Promise<MachineModel> {
  return mapUniqueViolations(() =>
    db.transaction(async (tx) => {
      const before = await lockModel(tx, id);
      if (patch.name !== undefined) {
        await assertNameFree(tx, { brandId: before.brandId, machineTypeId: before.machineTypeId, name: patch.name, exceptId: id });
      }
      const [after] = await tx
        .update(machineModels)
        .set({ name: patch.name, needsReview: patch.needsReview, isActive: patch.isActive, updatedAt: new Date() })
        .where(eq(machineModels.id, id))
        .returning();
      await writeAudit(tx, { adminId, action: 'model.update', entityType: 'model', entityId: id, before: toModel(before), after: toModel(after!) });
      return toModel(after!);
    }),
  );
}

export interface MoveModelInput {
  brandId?: string;
  machineTypeId?: string;
}

/**
 * Moves a model to another brand and/or machine type, with the same checks as create (the destination brand makes
 * machines, the type is a machine type, key free in the brand, name free in the brand + type). A model that changes
 * brand goes last in its new brand. Moving to where it already is changes nothing.
 */
export async function moveModel(db: Db, adminId: string, id: string, input: MoveModelInput): Promise<MachineModel> {
  return mapUniqueViolations(() =>
    db.transaction(async (tx) => {
      const before = await lockModel(tx, id);
      const brandId = input.brandId ?? before.brandId;
      const machineTypeId = input.machineTypeId ?? before.machineTypeId;
      if (brandId === before.brandId && machineTypeId === before.machineTypeId) return toModel(before);
      // M5: refuse when listings reference this model

      const brand = await lockBrand(tx, brandId, 'share');
      assertMachineMaker(brand);
      await assertMachineType(tx, machineTypeId);
      if (brandId !== before.brandId) {
        const [clash] = await tx
          .select({ id: machineModels.id })
          .from(machineModels)
          .where(and(eq(machineModels.brandId, brandId), eq(machineModels.key, before.key)))
          .limit(1);
        if (clash) throw modelKeyTaken();
      }
      await assertNameFree(tx, { brandId, machineTypeId, name: before.name, exceptId: id });

      const [after] = await tx
        .update(machineModels)
        .set({
          brandId,
          machineTypeId,
          sortOrder: brandId === before.brandId ? before.sortOrder : await nextModelOrder(tx, brandId),
          updatedAt: new Date(),
        })
        .where(eq(machineModels.id, id))
        .returning();
      await writeAudit(tx, { adminId, action: 'model.move', entityType: 'model', entityId: id, before: toModel(before), after: toModel(after!) });
      return toModel(after!);
    }),
  );
}

/** `orderedIds` must be exactly the brand's models (active and inactive, every machine type). */
export async function reorderModels(db: Db, adminId: string, brandId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const [brand] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId));
    if (!brand) throw new NotFoundError('Brand');
    const current = await tx
      .select({ id: machineModels.id })
      .from(machineModels)
      .where(eq(machineModels.brandId, brandId))
      .orderBy(asc(machineModels.sortOrder), asc(machineModels.name));
    assertExactSet(current, orderedIds, 'models');

    for (const [index, id] of orderedIds.entries()) {
      await tx.update(machineModels).set({ sortOrder: index, updatedAt: new Date() }).where(eq(machineModels.id, id));
    }
    await writeAudit(tx, {
      adminId,
      action: 'model.reorder',
      entityType: 'brand',
      entityId: brandId,
      before: current.map((r) => r.id),
      after: orderedIds,
    });
  });
}

export async function deleteModel(db: Db, adminId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockModel(tx, id);
    // M5: refuse when listings reference this model
    await tx.delete(machineModels).where(eq(machineModels.id, id));
    await writeAudit(tx, { adminId, action: 'model.delete', entityType: 'model', entityId: id, before: toModel(before), after: null });
  });
}
