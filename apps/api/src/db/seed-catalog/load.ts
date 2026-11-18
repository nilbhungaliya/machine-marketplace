import { sql } from 'drizzle-orm';
import { CATALOG_KEY_REGEX, MAX_HIGHLIGHT_RANK, type FieldAppliesTo } from '@mpm/shared-types';
import { slugify } from '../../lib/slug.js';
import { countListings } from '../../services/catalog/listing-uses.js';
import { appliesToOverlap } from '../../services/catalog/template-clash.js';
import type { Tx } from '../index.js';
import { brands, categories, conditions, machineModels, templateFieldOptions, templateFields, units } from '../schema.js';
import type { CatalogSeed, SeedField, SeedMachineType, SeedPartGroup } from '../seed-data/catalog/types.js';

export const ALREADY_LOADED =
  'Catalogue already loaded. The database is the source of truth; use --reset only before go-live.';

/** Slugs the seed may write: `[a-z0-9-]` only, as the admin API allows (paths are slugs joined by `/`). */
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const SELECT_TYPES = new Set(['single_select', 'multi_select']);

const nameOf = (node: SeedMachineType | SeedPartGroup) => (typeof node === 'string' ? node : node.name);
const slugOf = (node: { name: string; slug?: string } | string) =>
  typeof node === 'string' ? slugify(node) : (node.slug ?? slugify(node.name));
const fieldsOf = (node: SeedMachineType | SeedPartGroup) => (typeof node === 'string' ? [] : (node.fields ?? []));
const partGroupsOf = (mt: SeedMachineType) => (typeof mt === 'string' ? [] : (mt.partGroups ?? []));
const appliesToOf = (field: SeedField): FieldAppliesTo => field.appliesTo ?? 'both';

/** Problems with one field on its own (`where` is "<node path> > <key>"). */
function fieldProblems(field: SeedField, nodePath: string, isPartGroup: boolean): string[] {
  const where = `${nodePath} > ${field.key}`;
  const out: string[] = [];
  if (!CATALOG_KEY_REGEX.test(field.key)) out.push(`${where}: invalid key "${field.key}"`);
  if (field.highlightRank !== undefined && (!Number.isInteger(field.highlightRank) || field.highlightRank < 1 || field.highlightRank > MAX_HIGHLIGHT_RANK)) {
    out.push(`${where}: highlight rank ${field.highlightRank} is outside 1–${MAX_HIGHLIGHT_RANK}`);
  }
  const isSelect = SELECT_TYPES.has(field.type);
  if (isSelect && !field.options?.length) out.push(`${where}: select field has no options`);
  if (!isSelect && field.options !== undefined) out.push(`${where}: options are only for select fields`);
  if (field.type !== 'number' && (field.unit !== undefined || field.min !== undefined || field.max !== undefined)) {
    out.push(`${where}: unit/min/max are only for number fields`);
  }
  if (isPartGroup && field.appliesTo === 'machines') out.push(`${where}: appliesTo 'machines' on a part-group field`);
  const optionKeys = new Set<string>();
  for (const option of field.options ?? []) {
    if (!CATALOG_KEY_REGEX.test(option.key)) out.push(`${where}: invalid option key "${option.key}"`);
    if (optionKeys.has(option.key)) out.push(`${where}: duplicate option key "${option.key}"`);
    optionKeys.add(option.key);
  }
  return out;
}

/**
 * Key and rank clashes that `own` (one node's fields) adds to `inherited` (its ancestors' fields). A key is unique across
 * the effective template whatever its appliesTo; a rank only among fields whose appliesTo overlap. Checked level by level
 * so each clash is reported once, at the node that introduces it.
 */
function clashProblems(inherited: SeedField[], own: SeedField[], nodePath: string): string[] {
  const out: string[] = [];
  const seen = [...inherited];
  for (const field of own) {
    if (seen.some((f) => f.key === field.key)) out.push(`${nodePath}: field key "${field.key}" appears twice in the effective template`);
    const rank = field.highlightRank;
    if (rank !== undefined && seen.some((f) => f.highlightRank === rank && appliesToOverlap(appliesToOf(f), appliesToOf(field)))) {
      out.push(`${nodePath}: highlight rank ${rank} is used twice in the effective template`);
    }
    seen.push(field);
  }
  return out;
}

/** Invalid slugs, and slugs that repeat among siblings under `parentPath` ("categories" / "brands" at the top). */
function slugProblems(items: { name: string; slug: string }[], parentPath: string): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  for (const { name, slug } of items) {
    const earlier = seen.get(slug);
    if (!SLUG_REGEX.test(slug)) out.push(`${parentPath}: invalid slug "${slug}" for "${name}"`);
    else if (earlier !== undefined) out.push(`${parentPath}: duplicate slug "${slug}" ("${earlier}" and "${name}")`);
    else seen.set(slug, name);
  }
  return out;
}

function keyListProblems(items: { key: string }[], where: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { key } of items) {
    if (!CATALOG_KEY_REGEX.test(key)) out.push(`${where}: invalid key "${key}"`);
    else if (seen.has(key)) out.push(`${where}: duplicate key "${key}"`);
    seen.add(key);
  }
  return out;
}

type NodeLevel = 'machine_category' | 'machine_type' | 'part_group';

/** Every node path of the seed with its level (paths as loadCatalog writes them). */
function nodePaths(seed: CatalogSeed): Map<string, NodeLevel> {
  const out = new Map<string, NodeLevel>();
  for (const category of seed.categories) {
    const categoryPath = slugOf(category);
    out.set(categoryPath, 'machine_category');
    for (const mt of category.machineTypes) {
      const typePath = `${categoryPath}/${slugOf(mt)}`;
      out.set(typePath, 'machine_type');
      for (const pg of partGroupsOf(mt)) out.set(`${typePath}/${slugOf(pg)}`, 'part_group');
    }
  }
  return out;
}

function treeProblems(seed: CatalogSeed): string[] {
  const out: string[] = [];
  out.push(...slugProblems(seed.categories.map((c) => ({ name: c.name, slug: slugOf(c) })), 'categories'));

  for (const category of seed.categories) {
    const categoryPath = slugOf(category);
    const categoryFields = category.fields ?? [];
    for (const f of categoryFields) out.push(...fieldProblems(f, categoryPath, false));
    out.push(...clashProblems([], categoryFields, categoryPath));
    out.push(...slugProblems(category.machineTypes.map((mt) => ({ name: nameOf(mt), slug: slugOf(mt) })), categoryPath));

    for (const mt of category.machineTypes) {
      const typePath = `${categoryPath}/${slugOf(mt)}`;
      const typeFields = fieldsOf(mt);
      for (const f of typeFields) out.push(...fieldProblems(f, typePath, false));
      out.push(...clashProblems(categoryFields, typeFields, typePath));
      const partGroups = partGroupsOf(mt);
      out.push(...slugProblems(partGroups.map((pg) => ({ name: nameOf(pg), slug: slugOf(pg) })), typePath));

      for (const pg of partGroups) {
        const groupPath = `${typePath}/${slugOf(pg)}`;
        for (const f of fieldsOf(pg)) out.push(...fieldProblems(f, groupPath, true));
        out.push(...clashProblems([...categoryFields, ...typeFields], fieldsOf(pg), groupPath));
      }
    }
  }
  return out;
}

function brandProblems(seed: CatalogSeed): string[] {
  const out: string[] = [];
  const paths = nodePaths(seed);
  out.push(...keyListProblems(seed.brands, 'brands'));
  out.push(...slugProblems(seed.brands.map((b) => ({ name: b.name, slug: slugify(b.name) })), 'brands'));

  for (const brand of seed.brands) {
    const where = `brands > ${brand.key}`;
    if (!brand.makesMachines && !brand.makesParts) out.push(`${where}: makes neither machines nor parts`);
    const models = brand.models ?? [];
    if (models.length && !brand.makesMachines) out.push(`${where}: has models but makesMachines is false`);
    out.push(...keyListProblems(models, `${where} models`));

    const namesByType = new Set<string>();
    for (const model of models) {
      const modelWhere = `${where} > ${model.key}`;
      const level = paths.get(model.machineType);
      if (level === undefined) out.push(`${modelWhere}: unknown machine type "${model.machineType}"`);
      else if (level !== 'machine_type') out.push(`${modelWhere}: "${model.machineType}" is not a machine type`);
      const nameKey = `${model.machineType}\n${model.name.toLowerCase()}`;
      if (namesByType.has(nameKey)) out.push(`${modelWhere}: model name "${model.name}" repeats for machine type "${model.machineType}"`);
      namesByType.add(nameKey);
    }
  }
  return out;
}

function masterProblems(seed: CatalogSeed): string[] {
  const out: string[] = [];
  out.push(...keyListProblems(seed.master.units, 'units'));
  for (const unit of seed.master.units) {
    if (!Number.isInteger(unit.decimals) || unit.decimals < 0 || unit.decimals > 3) {
      out.push(`units: invalid decimals "${unit.decimals}" for "${unit.key}"`);
    }
  }
  out.push(...keyListProblems(seed.master.conditions, 'conditions'));
  return out;
}

/** Human-readable problems with a seed, each naming the offending path or key; empty when it can be loaded. */
export function validateSeed(seed: CatalogSeed): string[] {
  return [...treeProblems(seed), ...brandProblems(seed), ...masterProblems(seed)];
}

export interface LoadCounts {
  categories: number;
  machineTypes: number;
  partGroups: number;
  fields: number;
  options: number;
  brands: number;
  models: number;
  units: number;
  conditions: number;
}

/**
 * Deletes every catalogue row, children before parents (no ON DELETE CASCADE in the schema). Exported for the
 * rolled-back loader tests.
 */
export async function clearCatalog(tx: Tx): Promise<void> {
  // M5 (F2 spec §16): listings reference categories, brands, models, units and conditions; a reset would break them.
  const listingCount = await countListings(tx);
  if (listingCount > 0) throw new Error(`Catalogue reset refused: ${listingCount} listings exist`);
  await tx.delete(templateFieldOptions);
  await tx.delete(templateFields);
  await tx.delete(machineModels);
  await tx.delete(brands);
  await tx.delete(categories).where(sql`${categories.level} = 'part_group'`);
  await tx.delete(categories).where(sql`${categories.level} = 'machine_type'`);
  await tx.delete(categories);
  await tx.delete(units);
  await tx.delete(conditions);
}

/** True when any catalogue table has a row (not only categories: a lone unit would otherwise fail on its unique key). */
async function catalogueHasRows(tx: Tx): Promise<boolean> {
  const tables = [categories, templateFields, templateFieldOptions, brands, machineModels, units, conditions];
  for (const table of tables) {
    if ((await tx.select({ id: table.id }).from(table).limit(1)).length > 0) return true;
  }
  return false;
}

/** A seed field as a template_fields row (numbers stored as numeric strings). */
function fieldRow(field: SeedField, categoryId: string, sortOrder: number) {
  return {
    categoryId,
    key: field.key,
    label: field.label,
    helpText: field.helpText ?? null,
    type: field.type,
    appliesTo: appliesToOf(field),
    unit: field.unit ?? null,
    min: field.min === undefined ? null : String(field.min),
    max: field.max === undefined ? null : String(field.max),
    required: field.required ?? false,
    filterable: field.filterable ?? false,
    highlightRank: field.highlightRank ?? null,
    sortOrder,
  };
}

/** Inserts one level of nodes; returns id by path. */
async function insertNodes(tx: Tx, rows: (typeof categories.$inferInsert)[]): Promise<Map<string, string>> {
  if (rows.length === 0) return new Map();
  const inserted = await tx.insert(categories).values(rows).returning({ id: categories.id, path: categories.path });
  return new Map(inserted.map((r) => [r.path, r.id]));
}

/**
 * Loads the starter catalogue (insert only), in seed order (`sortOrder` = index among siblings). Refuses a non-empty
 * catalogue unless `reset`, which first deletes every catalogue row. Every brand and model is loaded with
 * `needsReview: true` (drafts the client confirms, spec §6).
 */
export async function loadCatalog(tx: Tx, seed: CatalogSeed, opts: { reset: boolean }): Promise<LoadCounts> {
  const problems = validateSeed(seed);
  if (problems.length > 0) throw new Error(`Invalid catalogue seed:\n- ${problems.join('\n- ')}`);

  if (opts.reset) {
    await clearCatalog(tx);
  } else if (await catalogueHasRows(tx)) {
    throw new Error(ALREADY_LOADED);
  }

  // Nodes, one insert per level; ids mapped back by path.
  const categoryRows = seed.categories.map((c, i) => {
    const slug = slugOf(c);
    return {
      level: 'machine_category' as const,
      name: c.name,
      slug,
      path: slug,
      icon: c.icon,
      hasSides: c.hasSides ?? null,
      sideConvention: c.sideConvention ?? null,
      sortOrder: i,
    };
  });
  const categoryIds = await insertNodes(tx, categoryRows);

  const typeRows = seed.categories.flatMap((c) =>
    c.machineTypes.map((mt, j) => {
      const parentPath = slugOf(c);
      const slug = slugOf(mt);
      const settings: { hasSides?: boolean; sideConvention?: string } = typeof mt === 'string' ? {} : mt;
      return {
        parentId: categoryIds.get(parentPath)!,
        level: 'machine_type' as const,
        name: nameOf(mt),
        slug,
        path: `${parentPath}/${slug}`,
        hasSides: settings.hasSides ?? null,
        sideConvention: settings.sideConvention ?? null,
        sortOrder: j,
      };
    }),
  );
  const typeIds = await insertNodes(tx, typeRows);

  const groupRows = seed.categories.flatMap((c) =>
    c.machineTypes.flatMap((mt) => {
      const parentPath = `${slugOf(c)}/${slugOf(mt)}`;
      return partGroupsOf(mt).map((pg, k) => {
        const slug = slugOf(pg);
        return {
          parentId: typeIds.get(parentPath)!,
          level: 'part_group' as const,
          name: nameOf(pg),
          slug,
          path: `${parentPath}/${slug}`,
          hasSides: typeof pg === 'string' ? null : (pg.hasSides ?? null),
          sortOrder: k,
        };
      });
    }),
  );
  const groupIds = await insertNodes(tx, groupRows);

  // Fields of every level, then their options.
  const fieldsWithNode: { field: SeedField; categoryId: string; sortOrder: number }[] = [];
  const addFields = (fields: SeedField[], categoryId: string) =>
    fields.forEach((field, n) => fieldsWithNode.push({ field, categoryId, sortOrder: n }));
  for (const c of seed.categories) {
    const categoryPath = slugOf(c);
    addFields(c.fields ?? [], categoryIds.get(categoryPath)!);
    for (const mt of c.machineTypes) {
      const typePath = `${categoryPath}/${slugOf(mt)}`;
      addFields(fieldsOf(mt), typeIds.get(typePath)!);
      for (const pg of partGroupsOf(mt)) addFields(fieldsOf(pg), groupIds.get(`${typePath}/${slugOf(pg)}`)!);
    }
  }
  const insertedFields = fieldsWithNode.length
    ? await tx
        .insert(templateFields)
        .values(fieldsWithNode.map((f) => fieldRow(f.field, f.categoryId, f.sortOrder)))
        .returning({ id: templateFields.id, categoryId: templateFields.categoryId, key: templateFields.key })
    : [];
  const fieldId = new Map(insertedFields.map((f) => [`${f.categoryId}:${f.key}`, f.id]));
  const optionRows = fieldsWithNode.flatMap(({ field, categoryId }) =>
    (field.options ?? []).map((o, n) => ({ fieldId: fieldId.get(`${categoryId}:${field.key}`)!, key: o.key, label: o.label, sortOrder: n })),
  );
  if (optionRows.length) await tx.insert(templateFieldOptions).values(optionRows);

  // Brands and models, all drafts for the client to confirm.
  const brandRows = seed.brands.map((b, i) => ({
    key: b.key,
    name: b.name,
    slug: slugify(b.name),
    makesMachines: b.makesMachines,
    makesParts: b.makesParts,
    needsReview: true,
    sortOrder: i,
  }));
  const insertedBrands = brandRows.length
    ? await tx.insert(brands).values(brandRows).returning({ id: brands.id, key: brands.key })
    : [];
  const brandId = new Map(insertedBrands.map((b) => [b.key, b.id]));
  const modelRows = seed.brands.flatMap((b) =>
    (b.models ?? []).map((m, n) => ({
      key: m.key,
      brandId: brandId.get(b.key)!,
      machineTypeId: typeIds.get(m.machineType)!,
      name: m.name,
      needsReview: true,
      sortOrder: n,
    })),
  );
  if (modelRows.length) await tx.insert(machineModels).values(modelRows);

  // Master data.
  if (seed.master.units.length) {
    await tx.insert(units).values(
      seed.master.units.map((u, n) => ({
        key: u.key,
        label: u.label,
        decimals: u.decimals,
        isMachineUnit: u.isMachineUnit ?? false,
        sortOrder: n,
      })),
    );
  }
  if (seed.master.conditions.length) {
    await tx
      .insert(conditions)
      .values(seed.master.conditions.map((c, n) => ({ key: c.key, label: c.label, description: c.description, sortOrder: n })));
  }

  return {
    categories: categoryRows.length,
    machineTypes: typeRows.length,
    partGroups: groupRows.length,
    fields: fieldsWithNode.length,
    options: optionRows.length,
    brands: brandRows.length,
    models: modelRows.length,
    units: seed.master.units.length,
    conditions: seed.master.conditions.length,
  };
}
