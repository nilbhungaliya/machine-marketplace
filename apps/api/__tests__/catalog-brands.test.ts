import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { Brand, BrandWithModels, MachineModel } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, machineModels } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import {
  createTestBrand,
  createTestCatalog,
  deleteTestBrands,
  deleteTestCatalog,
  type TestBrand,
  type TestCatalog,
} from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import {
  createTestSeller,
  deleteTestListings,
  deleteTestSellerExtras,
  insertTestListing,
  type TestSeller,
} from './_helpers/test-listings.js';

describe('brands and machine models API', () => {
  let app: FastifyInstance;
  let manager: { id: string; token: string };
  let moderator: { id: string; token: string };
  /** Every root and brand this suite created (fixtures and through the API). */
  const rootIds: string[] = [];
  const brandIds: string[] = [];
  const sellers: TestSeller[] = [];
  let seq = 0;

  /** Unique per call: brand keys and slugs made through the API carry it. */
  const stamp = () => `${Date.now()}${seq++}`;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    manager = await createTestAdmin('category_manager');
    moderator = await createTestAdmin('moderator');
  });

  afterAll(async () => {
    // Before app.close(): closing the app ends the shared pg pool. Listings first (they reference brands, models and
    // nodes), then brands (and their models): models reference the types.
    await deleteTestBusinesses(sellers.map((s) => s.businessId));
    await deleteTestSellerExtras(sellers);
    await deleteTestBrands(brandIds);
    for (const id of rootIds) await deleteTestCatalog(id);
    await deleteTestAdmins([manager?.id, moderator?.id].filter((id): id is string => !!id));
    await app?.close();
  });

  function call(method: InjectOptions['method'], url: string, body?: unknown, token = manager.token) {
    return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: body as InjectOptions['payload'] });
  }

  async function fixture(): Promise<TestCatalog> {
    const cat = await createTestCatalog();
    rootIds.push(cat.categoryId);
    return cat;
  }

  async function brandFixture(opts: { makesMachines?: boolean; makesParts?: boolean } = {}): Promise<TestBrand> {
    const brand = await createTestBrand(opts);
    brandIds.push(brand.id);
    return brand;
  }

  /** A second machine type under the fixture's category. */
  async function secondType(cat: TestCatalog, name = 'Test Rapier'): Promise<string> {
    const res = await call('POST', '/admin/categories', { parentId: cat.categoryId, name });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data.id as string;
  }

  async function createBrand(body: Record<string, unknown>): Promise<Brand> {
    const res = await call('POST', '/admin/brands', body);
    expect(res.statusCode, res.body).toBe(201);
    const brand = res.json().data as Brand;
    brandIds.push(brand.id);
    return brand;
  }

  async function createModel(body: Record<string, unknown>): Promise<MachineModel> {
    const res = await call('POST', '/admin/models', body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as MachineModel;
  }

  async function publicModels(query: string): Promise<MachineModel[]> {
    const res = await app.inject({ method: 'GET', url: `/models?${query}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data as MachineModel[];
  }

  async function publicBrands(query: string): Promise<Brand[]> {
    const res = await app.inject({ method: 'GET', url: `/brands?${query}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data as Brand[];
  }

  async function audit(action: string, entityId: string) {
    return db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.adminId, manager.id), eq(auditLog.action, action), eq(auditLog.entityId, entityId)));
  }

  it('creates a machine brand and a model under Test Loom; GET /models?machineTypeId lists it; GET /brands?machineTypeId lists the brand', async () => {
    const cat = await fixture();
    const s = stamp();
    const brand = await createBrand({ key: `test_brand_${s}`, name: `Test Brand ${s}`, makesMachines: true, makesParts: false });
    expect(brand).toMatchObject({
      key: `test_brand_${s}`,
      name: `Test Brand ${s}`,
      slug: `test-brand-${s}`,
      makesMachines: true,
      makesParts: false,
      needsReview: false,
      isActive: true,
    });

    const model = await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'tmar_kc', name: 'TMAR-KC' });
    expect(model).toMatchObject({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'tmar_kc', name: 'TMAR-KC', needsReview: false, isActive: true });

    expect((await publicModels(`machineTypeId=${cat.machineTypeId}`)).map((m) => m.id)).toEqual([model.id]);
    expect((await publicModels(`brandId=${brand.id}`)).map((m) => m.id)).toEqual([model.id]);
    expect((await publicBrands(`machineTypeId=${cat.machineTypeId}`)).map((b) => b.id)).toEqual([brand.id]);
    expect((await publicBrands('role=machines')).map((b) => b.id)).toContain(brand.id);
    expect((await publicBrands('role=parts')).map((b) => b.id)).not.toContain(brand.id);

    // The admin list nests models under their brand.
    const admin = await call('GET', '/admin/brands', undefined, moderator.token);
    expect(admin.statusCode, admin.body).toBe(200);
    const mine = (admin.json().data as BrandWithModels[]).find((b) => b.id === brand.id);
    expect(mine?.models.map((m) => m.id)).toEqual([model.id]);
  });

  it('bad query values → 400', async () => {
    expect((await app.inject({ method: 'GET', url: '/brands?role=both' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/models?brandId=nope' })).statusCode).toBe(400);
  });

  it('model under a part group → 400 NOT_A_MACHINE_TYPE; model for a parts-only brand → 400 BRAND_NOT_MACHINE_MAKER; brand with both flags false → 400', async () => {
    const cat = await fixture();
    const machines = await brandFixture();
    const partsOnly = await brandFixture({ makesMachines: false, makesParts: true });

    const underGroup = await call('POST', '/admin/models', { brandId: machines.id, machineTypeId: cat.partGroupId, key: 'm1', name: 'M1' });
    expect(underGroup.statusCode, underGroup.body).toBe(400);
    expect(underGroup.json().code).toBe('NOT_A_MACHINE_TYPE');

    const underCategory = await call('POST', '/admin/models', { brandId: machines.id, machineTypeId: cat.categoryId, key: 'm1', name: 'M1' });
    expect(underCategory.json().code).toBe('NOT_A_MACHINE_TYPE');

    const partsBrand = await call('POST', '/admin/models', { brandId: partsOnly.id, machineTypeId: cat.machineTypeId, key: 'm1', name: 'M1' });
    expect(partsBrand.statusCode, partsBrand.body).toBe(400);
    expect(partsBrand.json().code).toBe('BRAND_NOT_MACHINE_MAKER');

    const s = stamp();
    const noFlags = await call('POST', '/admin/brands', { key: `test_brand_${s}`, name: `Test Brand ${s}`, makesMachines: false, makesParts: false });
    expect(noFlags.statusCode, noFlags.body).toBe(400);
    expect(noFlags.json().code).toBe('FIELD_INVALID');

    // Turning the last flag off on an existing brand is refused the same way.
    const clearParts = await call('PATCH', `/admin/brands/${partsOnly.id}`, { makesParts: false });
    expect(clearParts.statusCode, clearParts.body).toBe(400);
    expect(clearParts.json().code).toBe('FIELD_INVALID');
  });

  it('same model name in another case under the same brand and type → 409 NAME_TAKEN; same name under another machine type → 201 (§11 call 5)', async () => {
    const cat = await fixture();
    const rapierId = await secondType(cat);
    const brand = await brandFixture();
    await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'lwt710', name: 'LWT710' });

    const dup = await call('POST', '/admin/models', { brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'lwt710_b', name: 'lwt710' });
    expect(dup.statusCode, dup.body).toBe(409);
    expect(dup.json().code).toBe('NAME_TAKEN');

    const otherType = await createModel({ brandId: brand.id, machineTypeId: rapierId, key: 'lwt710_rapier', name: 'LWT710' });
    expect(otherType.machineTypeId).toBe(rapierId);

    // Renaming onto another model's name (other case) is refused too; renaming a model to its own name in another case is fine.
    const other = await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'lwt810', name: 'LWT810' });
    const rename = await call('PATCH', `/admin/models/${other.id}`, { name: 'Lwt710' });
    expect(rename.statusCode, rename.body).toBe(409);
    expect(rename.json().code).toBe('NAME_TAKEN');
    const recase = await call('PATCH', `/admin/models/${other.id}`, { name: 'lwt810' });
    expect(recase.statusCode, recase.body).toBe(200);
    expect(recase.json().data).toMatchObject({ key: 'lwt810', name: 'lwt810' });
  });

  it('duplicate brand key → 409 KEY_TAKEN; duplicate slug → 409 SLUG_TAKEN; duplicate model key under a brand → 409 KEY_TAKEN (Review Focus 2)', async () => {
    const cat = await fixture();
    const existing = await brandFixture();

    const dupKey = await call('POST', '/admin/brands', { key: existing.key, name: 'Other', slug: `test-brand-${stamp()}`, makesMachines: true, makesParts: false });
    expect(dupKey.statusCode, dupKey.body).toBe(409);
    expect(dupKey.json().code).toBe('KEY_TAKEN');

    const s = stamp();
    const dupSlug = await call('POST', '/admin/brands', { key: `test_brand_${s}`, name: 'Other', slug: existing.slug, makesMachines: true, makesParts: false });
    expect(dupSlug.statusCode, dupSlug.body).toBe(409);
    expect(dupSlug.json().code).toBe('SLUG_TAKEN');

    await createModel({ brandId: existing.id, machineTypeId: cat.machineTypeId, key: 'k1', name: 'K1' });
    const dupModelKey = await call('POST', '/admin/models', { brandId: existing.id, machineTypeId: cat.machineTypeId, key: 'k1', name: 'K one' });
    expect(dupModelKey.statusCode, dupModelKey.body).toBe(409);
    expect(dupModelKey.json().code).toBe('KEY_TAKEN');

    // Keys are fixed once created.
    expect((await call('PATCH', `/admin/brands/${existing.id}`, { key: 'other_key' })).statusCode).toBe(400);
  });

  it('deactivating Test Loom removes its models from GET /models and the brand from GET /brands?machineTypeId (Review Focus 3)', async () => {
    const cat = await fixture();
    const rapierId = await secondType(cat);
    const brand = await brandFixture();
    const loomModel = await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'loom_1', name: 'Loom 1' });
    const rapierModel = await createModel({ brandId: brand.id, machineTypeId: rapierId, key: 'rapier_1', name: 'Rapier 1' });

    const off = await call('PATCH', `/admin/categories/${cat.machineTypeId}`, { isActive: false });
    expect(off.statusCode, off.body).toBe(200);

    expect(await publicModels(`machineTypeId=${cat.machineTypeId}`)).toEqual([]);
    expect((await publicModels(`brandId=${brand.id}`)).map((m) => m.id)).toEqual([rapierModel.id]);
    expect((await publicBrands(`machineTypeId=${cat.machineTypeId}`)).map((b) => b.id)).not.toContain(brand.id);
    // Its model of another, active type still lists it.
    expect((await publicBrands(`machineTypeId=${rapierId}`)).map((b) => b.id)).toEqual([brand.id]);

    // An inactive ancestor (the machine category) hides the rest.
    const rootOff = await call('PATCH', `/admin/categories/${cat.categoryId}`, { isActive: false });
    expect(rootOff.statusCode, rootOff.body).toBe(200);
    expect(await publicModels(`brandId=${brand.id}`)).toEqual([]);
    expect(await publicBrands(`machineTypeId=${rapierId}`)).toEqual([]);

    // Admin still sees everything.
    const admin = (await call('GET', '/admin/brands')).json().data as BrandWithModels[];
    expect(admin.find((b) => b.id === brand.id)?.models.map((m) => m.id).sort()).toEqual([loomModel.id, rapierModel.id].sort());
  });

  it('an inactive model or brand is hidden from the public lists', async () => {
    const cat = await fixture();
    const brand = await brandFixture();
    const a = await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'a1', name: 'A1' });
    const b = await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'b1', name: 'B1' });

    expect((await call('PATCH', `/admin/models/${a.id}`, { isActive: false })).statusCode).toBe(200);
    expect((await publicModels(`brandId=${brand.id}`)).map((m) => m.id)).toEqual([b.id]);

    expect((await call('PATCH', `/admin/models/${b.id}`, { isActive: false })).statusCode).toBe(200);
    // No active model of the type left: the brand drops out of the type's list, but stays in the plain list.
    expect((await publicBrands(`machineTypeId=${cat.machineTypeId}`)).map((x) => x.id)).not.toContain(brand.id);
    expect((await publicBrands('')).map((x) => x.id)).toContain(brand.id);

    expect((await call('PATCH', `/admin/models/${b.id}`, { isActive: true })).statusCode).toBe(200);
    const brandOff = await call('PATCH', `/admin/brands/${brand.id}`, { isActive: false });
    expect(brandOff.statusCode, brandOff.body).toBe(200);
    expect((await publicBrands('')).map((x) => x.id)).not.toContain(brand.id);
    expect(await publicModels(`brandId=${brand.id}`)).toEqual([]);
    expect((await publicModels(`machineTypeId=${cat.machineTypeId}`)).map((m) => m.id)).not.toContain(b.id);
  });

  it('delete a brand with models → 409 BRAND_IN_USE; makesMachines false while it has models → 409 BRAND_IN_USE', async () => {
    const cat = await fixture();
    const brand = await brandFixture({ makesMachines: true, makesParts: true });
    const model = await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'used_1', name: 'Used 1' });

    const del = await call('DELETE', `/admin/brands/${brand.id}`);
    expect(del.statusCode, del.body).toBe(409);
    expect(del.json().code).toBe('BRAND_IN_USE');

    const noMachines = await call('PATCH', `/admin/brands/${brand.id}`, { makesMachines: false });
    expect(noMachines.statusCode, noMachines.body).toBe(409);
    expect(noMachines.json().code).toBe('BRAND_IN_USE');

    // Once the model is gone, both work.
    expect((await call('DELETE', `/admin/models/${model.id}`)).statusCode).toBe(200);
    expect(await db.select().from(machineModels).where(eq(machineModels.id, model.id))).toHaveLength(0);
    const flagOff = await call('PATCH', `/admin/brands/${brand.id}`, { makesMachines: false });
    expect(flagOff.statusCode, flagOff.body).toBe(200);
    expect(flagOff.json().data).toMatchObject({ makesMachines: false, makesParts: true });
    expect((await call('DELETE', `/admin/brands/${brand.id}`)).statusCode).toBe(200);
    expect((await call('PATCH', `/admin/brands/${brand.id}`, { name: 'Gone' })).statusCode).toBe(404);
  });

  async function seller(): Promise<TestSeller> {
    const s = await createTestSeller();
    sellers.push(s);
    return s;
  }

  it('M5 guard: delete a brand used as part brand, machine make or fitment brand → 409 BRAND_IN_USE; passes once unused', async () => {
    const cat = await fixture();
    const s = await seller();
    const base = { businessId: s.businessId, userId: s.userId, status: 'draft' as const };
    const partBrand = await brandFixture({ makesMachines: false, makesParts: true });
    const make = await brandFixture();
    const fitBrand = await brandFixture();
    const uses = [
      await insertTestListing(db, { ...base, kind: 'part', categoryId: cat.partGroupId, partBrandId: partBrand.id }),
      await insertTestListing(db, { ...base, kind: 'machine', categoryId: cat.machineTypeId, machine: { brandId: make.id } }),
      await insertTestListing(db, { ...base, kind: 'part', categoryId: cat.partGroupId, fitments: [{ brandId: fitBrand.id }] }),
    ];

    for (const brand of [partBrand, make, fitBrand]) {
      const res = await call('DELETE', `/admin/brands/${brand.id}`);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().code).toBe('BRAND_IN_USE');
    }

    await deleteTestListings(db, uses.map((u) => u.id));
    for (const brand of [partBrand, make, fitBrand]) {
      expect((await call('DELETE', `/admin/brands/${brand.id}`)).statusCode).toBe(200);
    }
  });

  it('M5 guard: move or delete a model used by a listing machine or a fitment row → 409 MODEL_IN_USE; passes once unused', async () => {
    const cat = await fixture();
    const s = await seller();
    const base = { businessId: s.businessId, userId: s.userId, status: 'live' as const };
    const brand = await brandFixture();
    const other = await brandFixture();
    const machineModel = await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'mach_1', name: 'Mach 1' });
    const fitModel = await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'fit_1', name: 'Fit 1' });
    const uses = [
      await insertTestListing(db, {
        ...base, kind: 'machine', categoryId: cat.machineTypeId, machine: { brandId: brand.id, modelId: machineModel.id },
      }),
      await insertTestListing(db, {
        ...base, kind: 'part', categoryId: cat.partGroupId, fitments: [{ brandId: brand.id, modelId: fitModel.id }],
      }),
    ];

    for (const model of [machineModel, fitModel]) {
      const move = await call('POST', `/admin/models/${model.id}/move`, { brandId: other.id });
      expect(move.statusCode, move.body).toBe(409);
      expect(move.json().code).toBe('MODEL_IN_USE');
      const del = await call('DELETE', `/admin/models/${model.id}`);
      expect(del.statusCode, del.body).toBe(409);
      expect(del.json().code).toBe('MODEL_IN_USE');
    }

    await deleteTestListings(db, uses.map((u) => u.id));
    expect((await call('POST', `/admin/models/${machineModel.id}/move`, { brandId: other.id })).statusCode).toBe(200);
    expect((await call('DELETE', `/admin/models/${fitModel.id}`)).statusCode).toBe(200);
  });

  it('reorder models with a stale list → 409 STALE_ORDER and order unchanged (Review Focus 5); brands too', async () => {
    const cat = await fixture();
    const brand = await brandFixture();
    const first = await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'first', name: 'First' });
    const second = await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'second', name: 'Second' });
    expect([first.sortOrder, second.sortOrder]).toEqual([0, 1]);

    const stale = await call('POST', `/admin/brands/${brand.id}/models/reorder`, { orderedIds: [second.id] });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().code).toBe('STALE_ORDER');
    expect((await publicModels(`brandId=${brand.id}`)).map((m) => m.id)).toEqual([first.id, second.id]);

    const ok = await call('POST', `/admin/brands/${brand.id}/models/reorder`, { orderedIds: [second.id, first.id] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await publicModels(`brandId=${brand.id}`)).map((m) => m.id)).toEqual([second.id, first.id]);

    // A repeated id is never the exact list of all brands. (A full brand reorder would touch every brand in the shared
    // database, so only the stale case is tested here.)
    const staleBrands = await call('POST', '/admin/brands/reorder', { orderedIds: [brand.id, brand.id] });
    expect(staleBrands.statusCode, staleBrands.body).toBe(409);
    expect(staleBrands.json().code).toBe('STALE_ORDER');
  });

  it('reorder brands with a list read before another brand was added → 409 STALE_ORDER and order unchanged (Review Focus 5)', async () => {
    const adminBrandIds = async () => {
      const res = await call('GET', '/admin/brands');
      expect(res.statusCode, res.body).toBe(200);
      return (res.json().data as BrandWithModels[]).map((b) => b.id);
    };
    const before = await adminBrandIds();
    // Added after the list was read (removed in afterAll); the refused reorder writes nothing.
    const added = await brandFixture();

    const stale = await call('POST', '/admin/brands/reorder', { orderedIds: before });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().code).toBe('STALE_ORDER');
    expect((await adminBrandIds()).filter((id) => id !== added.id)).toEqual(before);
  });

  it('moving a model to another brand that already has its key → 409 KEY_TAKEN; to a brand + type that already has its name (other case) → 409 NAME_TAKEN', async () => {
    const cat = await fixture();
    const rapierId = await secondType(cat);
    const from = await brandFixture();
    const to = await brandFixture();
    const partsOnly = await brandFixture({ makesMachines: false, makesParts: true });
    const moving = await createModel({ brandId: from.id, machineTypeId: cat.machineTypeId, key: 'shared_key', name: 'Mover' });
    await createModel({ brandId: to.id, machineTypeId: rapierId, key: 'shared_key', name: 'Something else' });
    await createModel({ brandId: to.id, machineTypeId: cat.machineTypeId, key: 'other_key', name: 'MOVER' });

    const keyClash = await call('POST', `/admin/models/${moving.id}/move`, { brandId: to.id });
    expect(keyClash.statusCode, keyClash.body).toBe(409);
    expect(keyClash.json().code).toBe('KEY_TAKEN');

    // Same brand, only the type changes: the brand already has "mover" under Test Rapier, so the name check fails
    // (the key check passes: the model keeps its brand and "shared_key" is unique within it).
    const fromRapier = await createModel({ brandId: from.id, machineTypeId: rapierId, key: 'rapier_mover', name: 'mover' });
    const nameClash = await call('POST', `/admin/models/${moving.id}/move`, { machineTypeId: rapierId });
    expect(nameClash.statusCode, nameClash.body).toBe(409);
    expect(nameClash.json().code).toBe('NAME_TAKEN');

    const notType = await call('POST', `/admin/models/${moving.id}/move`, { machineTypeId: cat.partGroupId });
    expect(notType.json().code).toBe('NOT_A_MACHINE_TYPE');
    const notMaker = await call('POST', `/admin/models/${fromRapier.id}/move`, { brandId: partsOnly.id });
    expect(notMaker.json().code).toBe('BRAND_NOT_MACHINE_MAKER');
    expect((await call('POST', `/admin/models/${moving.id}/move`, {})).statusCode).toBe(400);

    // Brand and type at once: "MOVER" is already the to-brand's name under Test Loom.
    const bothClash = await call('POST', `/admin/models/${fromRapier.id}/move`, { brandId: to.id, machineTypeId: cat.machineTypeId });
    expect(bothClash.statusCode, bothClash.body).toBe(409);
    expect(bothClash.json().code).toBe('NAME_TAKEN');

    // A free destination works and puts the model last in its new brand.
    const fine = await call('POST', `/admin/models/${fromRapier.id}/move`, { brandId: to.id });
    expect(fine.statusCode, fine.body).toBe(200);
    expect(fine.json().data).toMatchObject({ id: fromRapier.id, brandId: to.id, machineTypeId: rapierId, sortOrder: 2 });

    const [moveAudit] = await audit('model.move', fromRapier.id);
    expect(moveAudit).toMatchObject({ entityType: 'model' });
    expect(moveAudit!.before).toMatchObject({ brandId: from.id, machineTypeId: rapierId });
    expect(moveAudit!.after).toMatchObject({ brandId: to.id, machineTypeId: rapierId });
  });

  it('the case-insensitive name index holds under a race: two parallel creates of "TMAR-KC" and "tmar-kc" → one 201, one 409 NAME_TAKEN (Review Focus 2)', async () => {
    const cat = await fixture();
    const brand = await brandFixture();
    const results = await Promise.all([
      call('POST', '/admin/models', { brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'tmar_kc_a', name: 'TMAR-KC' }),
      call('POST', '/admin/models', { brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'tmar_kc_b', name: 'tmar-kc' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('NAME_TAKEN');
    expect(await db.select().from(machineModels).where(eq(machineModels.brandId, brand.id))).toHaveLength(1);
  });

  it('two parallel creates of the same brand key → one 201, one 409 KEY_TAKEN (Review Focus 2)', async () => {
    const s = stamp();
    const body = { key: `test_brand_${s}`, name: `Test Brand ${s}`, makesMachines: true, makesParts: false };
    const results = await Promise.all([call('POST', '/admin/brands', body), call('POST', '/admin/brands', { ...body, slug: `test-brand-${s}-b` })]);
    for (const r of results) if (r.statusCode === 201) brandIds.push(r.json().data.id);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('KEY_TAKEN');
  });

  it('moderator can GET /admin/brands but writes → 403', async () => {
    const cat = await fixture();
    const brand = await brandFixture();
    expect((await call('GET', '/admin/brands', undefined, moderator.token)).statusCode).toBe(200);
    const s = stamp();
    const writes = await Promise.all([
      call('POST', '/admin/brands', { key: `test_brand_${s}`, name: 'X', makesMachines: true, makesParts: false }, moderator.token),
      call('PATCH', `/admin/brands/${brand.id}`, { name: 'X' }, moderator.token),
      call('DELETE', `/admin/brands/${brand.id}`, undefined, moderator.token),
      call('POST', '/admin/models', { brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'x1', name: 'X1' }, moderator.token),
    ]);
    for (const r of writes) {
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json().code).toBe('FORBIDDEN');
    }
    expect((await app.inject({ method: 'GET', url: '/admin/brands' })).statusCode).toBe(401);
  });

  it('every brand and model mutation writes an audit row', async () => {
    const cat = await fixture();
    const s = stamp();
    const brand = await createBrand({ key: `test_brand_${s}`, name: `Test Brand ${s}`, slug: `test-brand-${s}`, makesMachines: true, makesParts: true });
    const [created] = await audit('brand.create', brand.id);
    expect(created).toMatchObject({ entityType: 'brand', before: null });
    expect(created!.after).toMatchObject({ key: `test_brand_${s}`, makesParts: true });

    expect((await call('PATCH', `/admin/brands/${brand.id}`, { name: 'Renamed', needsReview: true })).statusCode).toBe(200);
    const [updated] = await audit('brand.update', brand.id);
    expect(updated!.before).toMatchObject({ name: `Test Brand ${s}`, needsReview: false });
    expect(updated!.after).toMatchObject({ name: 'Renamed', needsReview: true });

    const model = await createModel({ brandId: brand.id, machineTypeId: cat.machineTypeId, key: 'audited', name: 'Audited' });
    expect(await audit('model.create', model.id)).toHaveLength(1);
    expect((await call('PATCH', `/admin/models/${model.id}`, { needsReview: true })).statusCode).toBe(200);
    expect(await audit('model.update', model.id)).toHaveLength(1);
    expect((await call('POST', `/admin/brands/${brand.id}/models/reorder`, { orderedIds: [model.id] })).statusCode).toBe(200);
    const [reordered] = await audit('model.reorder', brand.id);
    expect(reordered).toMatchObject({ entityType: 'brand', after: [model.id] });
    expect((await call('DELETE', `/admin/models/${model.id}`)).statusCode).toBe(200);
    const [deletedModel] = await audit('model.delete', model.id);
    expect(deletedModel).toMatchObject({ after: null });
    expect(deletedModel!.before).toMatchObject({ key: 'audited' });

    expect((await call('DELETE', `/admin/brands/${brand.id}`)).statusCode).toBe(200);
    const [deletedBrand] = await audit('brand.delete', brand.id);
    expect(deletedBrand).toMatchObject({ entityType: 'brand', after: null });
  });

  it('unknown ids → 404', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await call('PATCH', `/admin/brands/${unknown}`, { name: 'X' })).statusCode).toBe(404);
    expect((await call('DELETE', `/admin/models/${unknown}`)).statusCode).toBe(404);
    expect((await call('POST', `/admin/brands/${unknown}/models/reorder`, { orderedIds: [unknown] })).statusCode).toBe(404);
  });
});
