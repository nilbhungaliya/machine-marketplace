import { and, asc, eq, exists, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Brand, BrandWithModels, MachineModel } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { brands, categories, machineModels } from '../../db/schema.js';

// Brand and machine-model reads (spec §6, §8). Public reads show only what a seller may pick: an active model of an
// active brand, under an active machine type whose machine category is active too. Admin reads include everything.

type BrandRow = typeof brands.$inferSelect;
type ModelRow = typeof machineModels.$inferSelect;

/** Row → API brand. Exported for the admin service (audit snapshots). */
export function toBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    slug: row.slug,
    makesMachines: row.makesMachines,
    makesParts: row.makesParts,
    needsReview: row.needsReview,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

/** Row → API model. Exported for the admin service (audit snapshots). */
export function toModel(row: ModelRow): MachineModel {
  return {
    id: row.id,
    key: row.key,
    brandId: row.brandId,
    machineTypeId: row.machineTypeId,
    name: row.name,
    needsReview: row.needsReview,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

// A model's machine type and that type's machine category (its only ancestor).
const typeNode = alias(categories, 'model_type');
const categoryNode = alias(categories, 'model_category');

/** The model, its machine type and the type's machine category are all active (the brand is checked by the caller's join). */
function modelTreeActive(): SQL {
  return and(eq(machineModels.isActive, true), eq(typeNode.isActive, true), eq(categoryNode.isActive, true))!;
}

export interface ListBrandsOptions {
  includeInactive: boolean;
  /** Only brands with a model of this machine type (public: an active model under an active type and category). */
  machineTypeId?: string;
  /** Only brands that make machines / parts. */
  role?: 'machines' | 'parts';
}

/** Brands by sortOrder, then name. */
export async function listBrands(db: Db | Tx, opts: ListBrandsOptions): Promise<Brand[]> {
  const where: SQL[] = [];
  if (!opts.includeInactive) where.push(eq(brands.isActive, true));
  if (opts.role === 'machines') where.push(eq(brands.makesMachines, true));
  if (opts.role === 'parts') where.push(eq(brands.makesParts, true));
  if (opts.machineTypeId !== undefined) {
    const ofType = [eq(machineModels.brandId, brands.id), eq(machineModels.machineTypeId, opts.machineTypeId)];
    if (!opts.includeInactive) ofType.push(modelTreeActive());
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(machineModels)
          .innerJoin(typeNode, eq(typeNode.id, machineModels.machineTypeId))
          .innerJoin(categoryNode, eq(categoryNode.id, typeNode.parentId))
          .where(and(...ofType)),
      ),
    );
  }

  const rows = await db
    .select()
    .from(brands)
    .where(and(...where))
    .orderBy(asc(brands.sortOrder), asc(brands.name));
  return rows.map(toBrand);
}

export interface ListModelsOptions {
  includeInactive: boolean;
  brandId?: string;
  machineTypeId?: string;
}

/** Models grouped by brand (brand order), then by sortOrder and name within a brand. */
export async function listModels(db: Db | Tx, opts: ListModelsOptions): Promise<MachineModel[]> {
  const where: SQL[] = [];
  if (opts.brandId !== undefined) where.push(eq(machineModels.brandId, opts.brandId));
  if (opts.machineTypeId !== undefined) where.push(eq(machineModels.machineTypeId, opts.machineTypeId));
  if (!opts.includeInactive) where.push(eq(brands.isActive, true), modelTreeActive());

  const rows = await db
    .select({ model: machineModels })
    .from(machineModels)
    .innerJoin(brands, eq(brands.id, machineModels.brandId))
    .innerJoin(typeNode, eq(typeNode.id, machineModels.machineTypeId))
    .innerJoin(categoryNode, eq(categoryNode.id, typeNode.parentId))
    .where(and(...where))
    .orderBy(asc(brands.sortOrder), asc(brands.name), asc(machineModels.sortOrder), asc(machineModels.name));
  return rows.map((r) => toModel(r.model));
}

/** Admin list: every brand with all its models, inactive included. */
export async function listBrandsWithModels(db: Db): Promise<BrandWithModels[]> {
  const [brandList, models] = await Promise.all([
    listBrands(db, { includeInactive: true }),
    listModels(db, { includeInactive: true }),
  ]);
  const byBrand = new Map<string, MachineModel[]>();
  for (const m of models) byBrand.set(m.brandId, [...(byBrand.get(m.brandId) ?? []), m]);
  return brandList.map((b) => ({ ...b, models: byBrand.get(b.id) ?? [] }));
}
