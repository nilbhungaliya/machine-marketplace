import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_SIDE_CONVENTION } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { categories, machineModels } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import {
  createTestBrand,
  createTestCatalog,
  deleteTestBrands,
  deleteTestCatalog,
  type TestBrand,
  type TestCatalog,
} from './_helpers/test-catalog.js';

describe('admin catalogue CSV export', () => {
  let app: FastifyInstance;
  let admin: { id: string; token: string };
  let cat: TestCatalog;
  let brand: TestBrand;
  let emptyBrand: TestBrand;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    admin = await createTestAdmin('moderator'); // any admin can read
    cat = await createTestCatalog();
    brand = await createTestBrand({ makesMachines: true, makesParts: true });
    emptyBrand = await createTestBrand({ makesMachines: false, makesParts: true });
    await db.insert(machineModels).values({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'tmar_kc', name: 'TMAR-KC', needsReview: true });
  });

  afterAll(async () => {
    // Before app.close(): closing the app ends the shared pg pool. Brands (and their models) before the catalogue.
    await deleteTestBrands([brand?.id, emptyBrand?.id].filter((id): id is string => !!id));
    if (cat) await deleteTestCatalog(cat.categoryId);
    if (admin) await deleteTestAdmins([admin.id]);
    await app?.close();
  });

  function exportSheet(sheet: string, token: string | null = admin.token) {
    return app.inject({
      method: 'GET',
      url: `/admin/catalog/export/${sheet}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  async function lines(sheet: string): Promise<string[]> {
    const res = await exportSheet(sheet);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body.startsWith('﻿')).toBe(true);
    return res.body.slice(1).split('\r\n');
  }

  it('tree: header, one row per part group in tree order, own and effective side settings', async () => {
    const rows = await lines('tree');
    expect(rows[0]).toBe(
      'Machine category,Machine type,Part group,Path,Active,Active (own),Has sides (own),Has sides (effective),Side convention (effective)',
    );
    const loomPath = `${cat.categorySlug}/test-loom`;
    const temples = rows.indexOf(`${cat.categoryName},Test Loom,Test Temples,${loomPath}/test-temples,Yes,Yes,,Yes,Seen by the weaver`);
    expect(temples).toBeGreaterThan(0);
    // Own "No" is printed; the effective convention is still shown (inherited from the loom).
    expect(rows[temples + 1]).toBe(`${cat.categoryName},Test Loom,Test Motors,${loomPath}/test-motors,Yes,Yes,No,No,Seen by the weaver`);
    // The category and the loom have children, so they get no row of their own.
    expect(rows.filter((l) => l.startsWith(`${cat.categoryName},`))).toHaveLength(2);
  });

  it('tree: a machine type without part groups gets its own row', async () => {
    await db.insert(categories).values({
      parentId: cat.categoryId,
      level: 'machine_type',
      name: 'Test Bare Type',
      slug: 'test-bare-type',
      path: `${cat.categorySlug}/test-bare-type`,
      sortOrder: 5,
      isActive: false,
    });
    const rows = await lines('tree');
    // Inactive nodes are exported too, marked. No convention on it or its category → the default (quoted: it has a comma).
    expect(rows).toContain(
      `${cat.categoryName},Test Bare Type,,${cat.categorySlug}/test-bare-type,No,No,,No,"${DEFAULT_SIDE_CONVENTION}"`,
    );
  });

  it('tree: a part group under a switched-off machine type is exported as inactive, with its own flag beside it', async () => {
    const [offType] = await db
      .insert(categories)
      .values({
        parentId: cat.categoryId,
        level: 'machine_type',
        name: 'Test Off Type',
        slug: 'test-off-type',
        path: `${cat.categorySlug}/test-off-type`,
        sortOrder: 6,
        isActive: false,
      })
      .returning({ id: categories.id });
    await db.insert(categories).values({
      parentId: offType!.id,
      level: 'part_group',
      name: 'Test Off Group',
      slug: 'test-off-group',
      path: `${cat.categorySlug}/test-off-type/test-off-group`,
      isActive: true,
    });
    const rows = await lines('tree');
    // Active = effective (No: its machine type is off); Active (own) = the part group's own flag (Yes).
    expect(rows).toContain(
      `${cat.categoryName},Test Off Type,Test Off Group,${cat.categorySlug}/test-off-type/test-off-group,No,Yes,,No,"${DEFAULT_SIDE_CONVENTION}"`,
    );
  });

  it('fields: every level with appliesTo, retired fields and options marked', async () => {
    const rows = await lines('fields');
    expect(rows[0]).toBe('Level,Category path,Field key,Label,Type,Applies to,Unit,Min,Max,Required,Filterable,Highlight rank,Status,Options');
    const mine = rows.filter((l) => l.includes(cat.categoryName));
    expect(mine.map((l) => l.split(',')[2])).toEqual(['old_note', 'reed_space', 'frame_width', 'loom_part_note', 'temple_type']);
    expect(mine.find((l) => l.includes(',reed_space,'))).toBe(
      `Machine type,${cat.categoryName} > Test Loom,reed_space,Reed space,number,machines,cm,,,No,No,1,active,`,
    );
    expect(mine.find((l) => l.includes(',old_note,'))).toMatch(/^Machine category,.*,retired,$/);
    expect(mine.find((l) => l.includes(',temple_type,'))).toBe(
      `Part group,${cat.categoryName} > Test Loom > Test Temples,temple_type,Temple type,single_select,parts,,,,No,No,,active,ring=Ring; roller=Roller (retired)`,
    );
  });

  it('brands-models: one row per model with its machine type path; a brand without models gets one row', async () => {
    const rows = await lines('brands-models');
    expect(rows[0]).toBe(
      'Brand,Brand key,Makes machines,Makes parts,Brand active,Brand needs review,Model,Model key,Machine type path,Model active,Model needs review',
    );
    expect(rows).toContain(`${brand.name},${brand.key},Yes,Yes,Yes,No,TMAR-KC,tmar_kc,${cat.categoryName} > Test Loom,Yes,Yes`);
    expect(rows).toContain(`${emptyBrand.name},${emptyBrand.key},No,Yes,Yes,No,,,,,`);
  });

  it('master-data: units then conditions', async () => {
    const rows = await lines('master-data');
    expect(rows[0]).toBe('List,Key,Label,Description,Decimals,Active');
    const unit = rows.indexOf(`Unit,${cat.unitKey},Test unit ${cat.suffix},,0,Yes`);
    const condition = rows.indexOf(`Condition,${cat.conditionKey},Test condition ${cat.suffix},,,Yes`);
    expect(unit).toBeGreaterThan(0);
    expect(condition).toBeGreaterThan(unit);
    // Every unit row comes before every condition row.
    const lists = rows.slice(1).map((l) => l.split(',')[0]);
    expect(lists.indexOf('Condition')).toBeGreaterThan(lists.lastIndexOf('Unit'));
  });

  it('sends CSV as a dated attachment', async () => {
    const res = await exportSheet('brands-models');
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="catalogue-brands-models-\d{4}-\d{2}-\d{2}\.csv"$/);
  });

  it('unknown sheet → 400; no token → 401', async () => {
    const unknown = await exportSheet('listings');
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().code).toBe('VALIDATION_ERROR');
    expect((await exportSheet('tree', null)).statusCode).toBe(401);
  });
});
