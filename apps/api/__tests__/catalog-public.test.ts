import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { CategoryNode, EffectiveTemplate, MasterData } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { categories } from '../src/db/schema.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';

describe('public catalogue API', () => {
  let app: FastifyInstance;
  let cat: TestCatalog;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    cat = await createTestCatalog();
  });

  afterAll(async () => {
    // Before app.close(): closing the app ends the shared pg pool.
    if (cat) await deleteTestCatalog(cat.categoryId);
    await app?.close();
  });

  async function getTree(): Promise<CategoryNode[]> {
    const res = await app.inject({ method: 'GET', url: '/categories' });
    expect(res.statusCode).toBe(200);
    return res.json().data as CategoryNode[];
  }

  const template = (id: string, kind?: string) =>
    app.inject({ method: 'GET', url: `/categories/${id}/template${kind ? `?kind=${kind}` : ''}` });

  it('GET /categories nests category → type → part groups in order with effective sides', async () => {
    const tree = await getTree();
    const category = tree.find((n) => n.id === cat.categoryId);
    expect(category).toBeDefined();
    expect(category!.level).toBe('machine_category');
    expect(category!.effectiveHasSides).toBe(false);
    expect(category!.children.map((c) => c.id)).toEqual([cat.machineTypeId]);
    const loom = category!.children[0]!;
    expect(loom.effectiveHasSides).toBe(true);
    expect(loom.children.map((c) => c.name)).toEqual(['Test Temples', 'Test Motors']);
    const [temples, motors] = loom.children as [CategoryNode, CategoryNode];
    expect(temples.effectiveHasSides).toBe(true);
    expect(temples.effectiveSideConvention).toBe('Seen by the weaver');
    expect(motors.effectiveHasSides).toBe(false);
  });

  it('part template at Test Temples', async () => {
    const res = await template(cat.partGroupId, 'part');
    expect(res.statusCode).toBe(200);
    const t = res.json().data as EffectiveTemplate;
    expect(t).toMatchObject({ nodeId: cat.partGroupId, kind: 'part' });
    // Category → machine type → part group, then sortOrder within each: temple_type (sortOrder 0) still comes after the loom's fields.
    // loom_part_note is a parts-only field on the machine type, so it reaches part templates.
    expect(t.fields.map((f) => f.key)).toEqual(['frame_width', 'loom_part_note', 'temple_type']);
    expect(t.fields.some((f) => f.key === 'reed_space' || f.key === 'old_note')).toBe(false);
    expect(t.fields.find((f) => f.key === 'temple_type')!.options.map((o) => o.key)).toEqual(['ring']);
    expect(t.fields.find((f) => f.key === 'frame_width')!.min).toBeNull();
  });

  it('machine template at Test Loom', async () => {
    const res = await template(cat.machineTypeId, 'machine');
    expect(res.statusCode).toBe(200);
    const t = res.json().data as EffectiveTemplate;
    // loom_part_note is the loom's own field but applies to parts only.
    expect(t.fields.map((f) => f.key)).toEqual(['reed_space', 'frame_width']);
    expect(t.fields.some((f) => f.key === 'loom_part_note')).toBe(false);
  });

  it('wrong level and bad input', async () => {
    expect((await template(cat.machineTypeId, 'part')).statusCode).toBe(404);
    expect((await template(cat.partGroupId, 'machine')).statusCode).toBe(404);
    expect((await template(cat.partGroupId)).statusCode).toBe(400);
    expect((await template('not-a-uuid', 'part')).statusCode).toBe(400);
  });

  it('inactive machine type hides its subtree and 404s its templates', async () => {
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, cat.machineTypeId));
    try {
      const category = (await getTree()).find((n) => n.id === cat.categoryId);
      expect(category).toBeDefined();
      expect(category!.children).toEqual([]);
      expect((await template(cat.partGroupId, 'part')).statusCode).toBe(404);
      expect((await template(cat.machineTypeId, 'machine')).statusCode).toBe(404);
    } finally {
      await db.update(categories).set({ isActive: true }).where(eq(categories.id, cat.machineTypeId));
    }
  });

  it('GET /master-data lists the test unit and condition', async () => {
    const res = await app.inject({ method: 'GET', url: '/master-data' });
    expect(res.statusCode).toBe(200);
    const md = res.json().data as MasterData;
    expect(md.units.find((u) => u.id === cat.unitId)).toMatchObject({ key: cat.unitKey, decimals: 0, isActive: true });
    expect(md.conditions.find((c) => c.id === cat.conditionId)).toMatchObject({ key: cat.conditionKey, isActive: true });
  });
});
