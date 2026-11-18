import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { db, type Tx } from '../src/db/index.js';
import { brands, businesses, categories, conditions, machineModels, templateFieldOptions, templateFields, units, users } from '../src/db/schema.js';
import { ALREADY_LOADED, clearCatalog, loadCatalog } from '../src/db/seed-catalog/load.js';
import { catalogSeed } from '../src/db/seed-data/catalog/index.js';
import type { CatalogSeed } from '../src/db/seed-data/catalog/types.js';
import { insertTestListing } from './_helpers/test-listings.js';
import { uniqueTestPhone } from './_helpers/test-users.js';

// Every case runs inside a transaction that is always rolled back, so nothing it writes or deletes is ever committed.
// Safe only because API test files never run in parallel (`fileParallelism: false` in vitest.config.ts): a case
// empties the whole catalogue inside its transaction, and another file's committed rows would otherwise be in the way.
const ROLLBACK = new Error('rollback');

async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
}

function makeFixture(): CatalogSeed {
  return {
    categories: [
      {
        name: 'Fixture Cat',
        icon: 'layers',
        machineTypes: [
          {
            name: 'Fixture Type',
            sideConvention: 'Left and right as seen by the weaver.',
            fields: [
              { key: 'reed_space', label: 'Reed space', type: 'number', appliesTo: 'machines', unit: 'cm', min: 150, max: 400, required: true, filterable: true, highlightRank: 1 },
              {
                key: 'nozzles',
                label: 'Nozzles',
                type: 'single_select',
                appliesTo: 'machines',
                options: [
                  { key: 'single', label: 'Single' },
                  { key: 'double', label: 'Double' },
                ],
              },
            ],
            partGroups: [
              'Cutters',
              {
                name: 'Temples',
                hasSides: true,
                fields: [{ key: 'item', label: 'Item', type: 'single_select', appliesTo: 'parts', options: [{ key: 'temple', label: 'Temple' }] }],
              },
            ],
          },
          'Second Type',
        ],
      },
      { name: 'Other Cat', icon: 'wrench', machineTypes: ['Boiler'] },
    ],
    brands: [
      { key: 'acme', name: 'Acme', makesMachines: true, makesParts: true, models: [{ key: 'ax_100', name: 'AX-100', machineType: 'fixture-cat/fixture-type' }] },
      { key: 'needle_co', name: 'Needle Co', makesMachines: false, makesParts: true },
    ],
    master: {
      units: [
        { key: 'pcs', label: 'Pieces', decimals: 0 },
        { key: 'kg', label: 'Kilograms', decimals: 3 },
      ],
      conditions: [{ key: 'used', label: 'Used', description: 'Removed from a working machine' }],
    },
  };
}

function makeReplacement(): CatalogSeed {
  return {
    categories: [{ name: 'Replacement Cat', icon: 'cog', machineTypes: ['Only Type'] }],
    brands: [],
    master: { units: [{ key: 'sets', label: 'Sets', decimals: 0 }], conditions: [] },
  };
}

/** Row counts of every catalogue table, to prove the real tables are untouched by this file. */
async function catalogueCounts() {
  const count = async (table: typeof categories | typeof templateFields | typeof templateFieldOptions | typeof brands | typeof machineModels | typeof units | typeof conditions) =>
    (await db.select().from(table)).length;
  return {
    categories: await count(categories),
    fields: await count(templateFields),
    options: await count(templateFieldOptions),
    brands: await count(brands),
    models: await count(machineModels),
    units: await count(units),
    conditions: await count(conditions),
  };
}

describe('loadCatalog (rolled back)', () => {
  let before: Awaited<ReturnType<typeof catalogueCounts>>;

  beforeAll(async () => {
    before = await catalogueCounts();
  });

  afterAll(async () => {
    expect(await catalogueCounts()).toEqual(before);
  });

  it('loads the fixture into an emptied catalogue', async () => {
    await inRolledBackTx(async (tx) => {
      await clearCatalog(tx);
      const counts = await loadCatalog(tx, makeFixture(), { reset: false });
      expect(counts).toEqual({ categories: 2, machineTypes: 3, partGroups: 2, fields: 3, options: 3, brands: 2, models: 1, units: 2, conditions: 1 });

      const nodes = await tx.select().from(categories).orderBy(asc(categories.path));
      expect(nodes.map((n) => [n.path, n.level])).toEqual([
        ['fixture-cat', 'machine_category'],
        ['fixture-cat/fixture-type', 'machine_type'],
        ['fixture-cat/fixture-type/cutters', 'part_group'],
        ['fixture-cat/fixture-type/temples', 'part_group'],
        ['fixture-cat/second-type', 'machine_type'],
        ['other-cat', 'machine_category'],
        ['other-cat/boiler', 'machine_type'],
      ]);
      const byPath = new Map(nodes.map((n) => [n.path, n]));
      const type = byPath.get('fixture-cat/fixture-type')!;
      expect(byPath.get('other-cat')).toMatchObject({ sortOrder: 1, icon: 'wrench', parentId: null, hasSides: null });
      expect(byPath.get('fixture-cat/second-type')).toMatchObject({ sortOrder: 1, parentId: byPath.get('fixture-cat')!.id });
      expect(type).toMatchObject({ sideConvention: 'Left and right as seen by the weaver.', hasSides: null });
      expect(byPath.get('fixture-cat/fixture-type/temples')).toMatchObject({ name: 'Temples', sortOrder: 1, hasSides: true, parentId: type.id });

      const fields = await tx.select().from(templateFields);
      expect(fields.find((f) => f.key === 'reed_space')).toMatchObject({
        categoryId: type.id, type: 'number', appliesTo: 'machines', unit: 'cm', min: '150.000', max: '400.000',
        required: true, filterable: true, highlightRank: 1, sortOrder: 0, status: 'active',
      });
      expect(fields.find((f) => f.key === 'item')).toMatchObject({ categoryId: byPath.get('fixture-cat/fixture-type/temples')!.id, appliesTo: 'parts' });
      const options = await tx.select().from(templateFieldOptions).orderBy(asc(templateFieldOptions.key));
      expect(options.map((o) => o.key)).toEqual(['double', 'single', 'temple']);

      const brandRows = await tx.select().from(brands).orderBy(asc(brands.sortOrder));
      expect(brandRows.map((b) => [b.key, b.slug, b.makesMachines, b.makesParts, b.needsReview])).toEqual([
        ['acme', 'acme', true, true, true],
        ['needle_co', 'needle-co', false, true, true],
      ]);
      const [model] = await tx.select().from(machineModels);
      expect(model).toMatchObject({ key: 'ax_100', name: 'AX-100', brandId: brandRows[0]!.id, machineTypeId: type.id, needsReview: true });

      expect((await tx.select().from(units).orderBy(asc(units.sortOrder))).map((u) => [u.key, u.decimals])).toEqual([
        ['pcs', 0],
        ['kg', 3],
      ]);
      expect(await tx.select().from(conditions)).toEqual([expect.objectContaining({ key: 'used', description: 'Removed from a working machine' })]);
    });
  });

  it('refuses a non-empty catalogue without reset, and writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      await clearCatalog(tx);
      await loadCatalog(tx, makeFixture(), { reset: false });
      await expect(loadCatalog(tx, makeReplacement(), { reset: false })).rejects.toThrow(ALREADY_LOADED);
      expect(await tx.select().from(categories).where(eq(categories.path, 'replacement-cat'))).toEqual([]);
    });
  });

  it('refuses when any catalogue table has rows (a unit only), not just categories', async () => {
    await inRolledBackTx(async (tx) => {
      await clearCatalog(tx);
      // Same key as a fixture unit: without the check this would fail on the unique key instead.
      await tx.insert(units).values({ key: 'pcs', label: 'Pieces', sortOrder: 0 });
      await expect(loadCatalog(tx, makeFixture(), { reset: false })).rejects.toThrow(ALREADY_LOADED);
      expect(await tx.select().from(categories)).toEqual([]);
    });
  });

  it('refuses an invalid seed before touching the database', async () => {
    await inRolledBackTx(async (tx) => {
      const seed = makeFixture();
      seed.brands[0]!.models![0]!.machineType = 'fixture-cat/nowhere';
      await expect(loadCatalog(tx, seed, { reset: true })).rejects.toThrow(/brands > acme > ax_100: unknown machine type "fixture-cat\/nowhere"/);
    });
  });

  it('loads the real starter catalogue', async () => {
    await inRolledBackTx(async (tx) => {
      const counts = await loadCatalog(tx, catalogSeed, { reset: true });
      expect(counts).toMatchObject({ categories: 10, brands: 14, models: 19, units: 8, conditions: 4 });
      expect(counts.machineTypes).toBeGreaterThanOrEqual(230);
      expect(counts.machineTypes).toBeLessThanOrEqual(270);

      const [hooks] = await tx
        .select()
        .from(categories)
        .where(eq(categories.path, 'sewing-embroidery-and-garments/multi-head-embroidery-machine/rotary-hooks-and-bobbin-cases'));
      expect(hooks).toMatchObject({ level: 'part_group', name: 'Rotary Hooks & Bobbin Cases' });
      const models = await tx.select().from(machineModels);
      expect(models.every((m) => m.needsReview)).toBe(true);
      expect((await tx.select().from(brands)).find((b) => b.key === 'lasser')).toMatchObject({ slug: 'lasser', needsReview: true });
    });
  });

  it('writes isMachineUnit for a flagged unit; the real seed flags machines', async () => {
    await inRolledBackTx(async (tx) => {
      await clearCatalog(tx);
      const seed = makeFixture();
      seed.master.units.push({ key: 'machines', label: 'Machines', decimals: 0, isMachineUnit: true });
      await loadCatalog(tx, seed, { reset: false });
      const rows = await tx.select({ key: units.key, flag: units.isMachineUnit }).from(units).orderBy(asc(units.sortOrder));
      expect(rows).toEqual([
        { key: 'pcs', flag: false },
        { key: 'kg', flag: false },
        { key: 'machines', flag: true },
      ]);
    });
    await inRolledBackTx(async (tx) => {
      await loadCatalog(tx, catalogSeed, { reset: true });
      const flagged = await tx.select({ key: units.key }).from(units).where(eq(units.isMachineUnit, true));
      expect(flagged).toEqual([{ key: 'machines' }]);
    });
  });

  it('M5 guard: clearCatalog refuses while any listing exists, naming the count', async () => {
    await inRolledBackTx(async (tx) => {
      // Everything here is written inside the rolled-back transaction: never reset data this test didn't create.
      const [business] = await tx.insert(businesses).values({ tradeName: 'Reset Guard Works' }).returning({ id: businesses.id });
      const [user] = await tx
        .insert(users)
        .values({ phone: uniqueTestPhone(), businessId: business!.id })
        .returning({ id: users.id });
      const base = { businessId: business!.id, userId: user!.id, status: 'draft' as const, categoryId: null };
      await insertTestListing(tx, { ...base, kind: 'part' });
      await insertTestListing(tx, { ...base, kind: 'part' });
      await expect(clearCatalog(tx)).rejects.toThrow(/Catalogue reset refused: 2 listings exist/);
      await expect(loadCatalog(tx, makeReplacement(), { reset: true })).rejects.toThrow(/Catalogue reset refused/);
    });
  });

  it('reset replaces every catalogue row', async () => {
    await inRolledBackTx(async (tx) => {
      await clearCatalog(tx);
      await loadCatalog(tx, makeFixture(), { reset: false });
      const counts = await loadCatalog(tx, makeReplacement(), { reset: true });
      expect(counts).toEqual({ categories: 1, machineTypes: 1, partGroups: 0, fields: 0, options: 0, brands: 0, models: 0, units: 1, conditions: 0 });

      expect((await tx.select().from(categories).orderBy(asc(categories.path))).map((n) => n.path)).toEqual(['replacement-cat', 'replacement-cat/only-type']);
      expect(await tx.select().from(templateFields)).toEqual([]);
      expect(await tx.select().from(templateFieldOptions)).toEqual([]);
      expect(await tx.select().from(brands)).toEqual([]);
      expect(await tx.select().from(machineModels)).toEqual([]);
      expect((await tx.select().from(units)).map((u) => u.key)).toEqual(['sets']);
      expect(await tx.select().from(conditions)).toEqual([]);
    });
  });
});
