import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { brands, categories, conditions, machineModels, templateFieldOptions, templateFields, units } from '../../src/db/schema.js';

/** Ids of everything createTestCatalog inserted. */
export interface TestCatalog {
  suffix: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  /** "Test Loom": hasSides true, convention 'Seen by the weaver'. */
  machineTypeId: string;
  /** "Test Temples": hasSides null (inherits true from the loom). */
  partGroupId: string;
  /** "Test Motors": hasSides false. */
  motorsGroupId: string;
  fieldIds: { reedSpace: string; frameWidth: string; loomPartNote: string; templeType: string; oldNote: string };
  optionIds: { ring: string; roller: string };
  unitId: string;
  unitKey: string;
  conditionId: string;
  conditionKey: string;
}

const SLUG_PREFIX = 'test-machines-';
let seq = 0;

/** Unit and condition each catalogue's root owns, keyed by the root's id (immutable, unlike a slug an admin test may rename). */
const masterDataByRoot = new Map<string, { unitId: string; conditionId: string }>();

/**
 * Inserts a small, self-contained tree:
 *   Test Machines <suffix> → Test Loom → Test Temples, Test Motors
 * Fields: loom `reed_space` (number, cm, machines, rank 1), loom `frame_width` (number, both, rank 2),
 * loom `loom_part_note` (text, parts, sortOrder 2),
 * Test Temples `temple_type` (single_select, parts; `ring`, `roller` retired), category `old_note` (text, retired).
 * Plus one unit and one condition. Remove with deleteTestCatalog(categoryId).
 */
export async function createTestCatalog(): Promise<TestCatalog> {
  const suffix = `${Date.now()}${seq++}`;
  const categoryName = `Test Machines ${suffix}`;
  const categorySlug = `${SLUG_PREFIX}${suffix}`;
  const unitKey = `test_unit_${suffix}`;
  const conditionKey = `test_cond_${suffix}`;

  return db.transaction(async (tx) => {
    const [cat] = await tx
      .insert(categories)
      .values({ level: 'machine_category', name: categoryName, slug: categorySlug, path: categorySlug, icon: 'factory', sortOrder: 9999, hasSides: null })
      .returning({ id: categories.id });
    const [loom] = await tx
      .insert(categories)
      .values({
        parentId: cat!.id, level: 'machine_type', name: 'Test Loom', slug: 'test-loom', path: `${categorySlug}/test-loom`,
        hasSides: true, sideConvention: 'Seen by the weaver',
      })
      .returning({ id: categories.id });
    const [temples] = await tx
      .insert(categories)
      .values({
        parentId: loom!.id, level: 'part_group', name: 'Test Temples', slug: 'test-temples',
        path: `${categorySlug}/test-loom/test-temples`, sortOrder: 0, hasSides: null,
      })
      .returning({ id: categories.id });
    const [motors] = await tx
      .insert(categories)
      .values({
        parentId: loom!.id, level: 'part_group', name: 'Test Motors', slug: 'test-motors',
        path: `${categorySlug}/test-loom/test-motors`, sortOrder: 1, hasSides: false,
      })
      .returning({ id: categories.id });

    const [reed] = await tx
      .insert(templateFields)
      .values({ categoryId: loom!.id, key: 'reed_space', label: 'Reed space', type: 'number', unit: 'cm', appliesTo: 'machines', highlightRank: 1, sortOrder: 0 })
      .returning({ id: templateFields.id });
    const [frame] = await tx
      .insert(templateFields)
      .values({ categoryId: loom!.id, key: 'frame_width', label: 'Frame width', type: 'number', appliesTo: 'both', highlightRank: 2, sortOrder: 1 })
      .returning({ id: templateFields.id });
    // Parts-only field on the machine type: in part templates below it, never in the loom's machine template.
    const [loomPartNote] = await tx
      .insert(templateFields)
      .values({ categoryId: loom!.id, key: 'loom_part_note', label: 'Loom part note', type: 'text', appliesTo: 'parts', sortOrder: 2 })
      .returning({ id: templateFields.id });
    const [templeType] = await tx
      .insert(templateFields)
      .values({ categoryId: temples!.id, key: 'temple_type', label: 'Temple type', type: 'single_select', appliesTo: 'parts', sortOrder: 0 })
      .returning({ id: templateFields.id });
    const [oldNote] = await tx
      .insert(templateFields)
      .values({ categoryId: cat!.id, key: 'old_note', label: 'Old note', type: 'text', sortOrder: 0, status: 'retired' })
      .returning({ id: templateFields.id });

    const [ring] = await tx
      .insert(templateFieldOptions)
      .values({ fieldId: templeType!.id, key: 'ring', label: 'Ring', sortOrder: 0 })
      .returning({ id: templateFieldOptions.id });
    const [roller] = await tx
      .insert(templateFieldOptions)
      .values({ fieldId: templeType!.id, key: 'roller', label: 'Roller', sortOrder: 1, status: 'retired' })
      .returning({ id: templateFieldOptions.id });

    const [unit] = await tx.insert(units).values({ key: unitKey, label: `Test unit ${suffix}`, sortOrder: 9999 }).returning({ id: units.id });
    const [cond] = await tx
      .insert(conditions)
      .values({ key: conditionKey, label: `Test condition ${suffix}`, sortOrder: 9999 })
      .returning({ id: conditions.id });
    masterDataByRoot.set(cat!.id, { unitId: unit!.id, conditionId: cond!.id });

    return {
      suffix,
      categoryId: cat!.id,
      categoryName,
      categorySlug,
      machineTypeId: loom!.id,
      partGroupId: temples!.id,
      motorsGroupId: motors!.id,
      fieldIds: { reedSpace: reed!.id, frameWidth: frame!.id, loomPartNote: loomPartNote!.id, templeType: templeType!.id, oldNote: oldNote!.id },
      optionIds: { ring: ring!.id, roller: roller!.id },
      unitId: unit!.id,
      unitKey,
      conditionId: cond!.id,
      conditionKey,
    };
  });
}

/**
 * Deletes a test category and everything under it (also nodes created through the admin API in tests), in FK order:
 * options → fields → models of its types → part groups → types → category; then the unit and condition createTestCatalog
 * made for it (recorded by root id at creation, so a renamed root still cleans up and a concurrent suite's fixtures are never
 * touched). No-op for an unknown id.
 */
export async function deleteTestCatalog(categoryId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const typeIds = (await tx.select({ id: categories.id }).from(categories).where(eq(categories.parentId, categoryId))).map((r) => r.id);
    const groupIds = typeIds.length
      ? (await tx.select({ id: categories.id }).from(categories).where(inArray(categories.parentId, typeIds))).map((r) => r.id)
      : [];
    const nodeIds = [categoryId, ...typeIds, ...groupIds];

    const fieldIds = (await tx.select({ id: templateFields.id }).from(templateFields).where(inArray(templateFields.categoryId, nodeIds))).map((r) => r.id);
    if (fieldIds.length) {
      await tx.delete(templateFieldOptions).where(inArray(templateFieldOptions.fieldId, fieldIds));
      await tx.delete(templateFields).where(inArray(templateFields.id, fieldIds));
    }
    if (typeIds.length) await tx.delete(machineModels).where(inArray(machineModels.machineTypeId, typeIds));
    if (groupIds.length) await tx.delete(categories).where(inArray(categories.id, groupIds));
    if (typeIds.length) await tx.delete(categories).where(inArray(categories.id, typeIds));
    await tx.delete(categories).where(eq(categories.id, categoryId));

    const owned = masterDataByRoot.get(categoryId);
    if (owned) {
      await tx.delete(units).where(eq(units.id, owned.unitId));
      await tx.delete(conditions).where(eq(conditions.id, owned.conditionId));
    }
  });
  masterDataByRoot.delete(categoryId);
}

export interface TestBrand {
  id: string;
  key: string;
  name: string;
  slug: string;
}

let brandSeq = 0;

/** Inserts a brand with a unique key, name and slug (makes machines unless told otherwise). Remove with deleteTestBrands. */
export async function createTestBrand(opts: { makesMachines?: boolean; makesParts?: boolean } = {}): Promise<TestBrand> {
  const suffix = `${Date.now()}${brandSeq++}`;
  const key = `test_brand_${suffix}`;
  const name = `Test Brand ${suffix}`;
  const slug = `test-brand-${suffix}`;
  const [row] = await db
    .insert(brands)
    .values({ key, name, slug, makesMachines: opts.makesMachines ?? true, makesParts: opts.makesParts ?? false, sortOrder: 9999 })
    .returning({ id: brands.id });
  return { id: row!.id, key, name, slug };
}

/** Deletes the brands' models (whatever machine type they sit under), then the brands. No-op for unknown ids. */
export async function deleteTestBrands(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.delete(machineModels).where(inArray(machineModels.brandId, ids));
    await tx.delete(brands).where(inArray(brands.id, ids));
  });
}
