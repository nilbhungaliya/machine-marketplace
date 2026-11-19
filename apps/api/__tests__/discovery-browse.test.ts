import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { BrandBrowseView, BrowseView, CategoryNode, ListingCard, ListingKind, ListingStatus } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { eq } from 'drizzle-orm';
import { categories, machineModels, savedListings } from '../src/db/schema.js';
import {
  createTestBrand,
  createTestCatalog,
  deleteTestBrands,
  deleteTestCatalog,
  type TestBrand,
  type TestCatalog,
} from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestDiscovery, deleteTestRedisKeys, testRunId } from './_helpers/test-discovery.js';
import {
  createTestSeller,
  deleteTestSellerExtras,
  insertTestListing,
  type TestFitment,
  type TestSeller,
} from './_helpers/test-listings.js';

// F4 + F5 spec §7 Browse, brand view, cards and `GET /categories?depth=1` (plan B2-1).

const runId = testRunId();
let app: FastifyInstance;
let catalog: TestCatalog;
let partBrand: TestBrand;
let maker: TestBrand;
let m1 = '';
let m2 = '';
let spinnerId = '';
let seller: TestSeller;
let viewer: TestSeller;
const sellers: TestSeller[] = [];
const ids: Record<string, string> = {};

// A spot no other suite uses (Bihar); "near" ~5 km, "far" ~150 km.
const HERE = { lat: 26.1, lng: 84.2 };
const NEAR = { lat: 26.15, lng: 84.2 };
const FAR = { lat: 27.45, lng: 84.2 };
const GPS = { point: HERE };

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  partBrand = await createTestBrand({ makesMachines: false, makesParts: true });
  maker = await createTestBrand({ makesMachines: true });
  const models = await db
    .insert(machineModels)
    .values([
      { key: `zb_m1_${catalog.suffix}`, brandId: maker.id, machineTypeId: catalog.machineTypeId, name: `Zb M1 ${catalog.suffix}`, sortOrder: 0 },
      { key: `zb_m2_${catalog.suffix}`, brandId: maker.id, machineTypeId: catalog.machineTypeId, name: `Zb M2 ${catalog.suffix}`, sortOrder: 1 },
    ])
    .returning({ id: machineModels.id });
  m1 = models[0]!.id;
  m2 = models[1]!.id;
  // A machine type with no listings: hidden from browse.
  const [spinner] = await db
    .insert(categories)
    .values({
      parentId: catalog.categoryId, level: 'machine_type', name: 'Test Spinner', slug: 'test-spinner',
      path: `${catalog.categorySlug}/test-spinner`, sortOrder: 5,
    })
    .returning({ id: categories.id });
  spinnerId = spinner!.id;

  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  viewer = await createTestSeller({ machineCategoryId: catalog.categoryId });
  sellers.push(seller, viewer);

  const add = async (
    name: string,
    o: {
      kind: ListingKind;
      categoryId: string;
      status?: ListingStatus;
      at?: { lat: number; lng: number };
      partBrandId?: string;
      fitments?: TestFitment[];
      machine?: { brandId: string; modelId?: string };
    },
  ) => {
    const r = await insertTestListing(db, {
      businessId: seller.businessId,
      userId: seller.userId,
      kind: o.kind,
      status: o.status ?? 'live',
      categoryId: o.categoryId,
      title: `Browse ${name}`,
      searchPoint: o.at ?? NEAR,
      partBrandId: o.partBrandId ?? null,
      fitments: o.fitments,
      ...(o.machine ? { machine: o.machine } : {}),
    });
    ids[name] = r.id;
  };
  await add('p1', { kind: 'part', categoryId: catalog.partGroupId, partBrandId: partBrand.id, fitments: [{ brandId: maker.id, modelId: m1 }] });
  await add('p2', { kind: 'part', categoryId: catalog.partGroupId, fitments: [{ brandId: maker.id }] });
  await add('p3', { kind: 'part', categoryId: catalog.motorsGroupId, fitments: [{ brandId: maker.id, modelOther: 'Xq 9' }] });
  await add('mach', { kind: 'machine', categoryId: catalog.machineTypeId, machine: { brandId: maker.id, modelId: m2 } });
  await add('rented', { kind: 'machine_rental', categoryId: catalog.machineTypeId, status: 'rented', machine: { brandId: maker.id, modelId: m2 } });
  await add('far', { kind: 'part', categoryId: catalog.partGroupId, at: FAR, fitments: [{ brandId: maker.id, modelId: m1 }] });
  await add('paused', { kind: 'part', categoryId: catalog.partGroupId, status: 'paused', partBrandId: partBrand.id });
});

afterAll(async () => {
  await deleteTestDiscovery(runId, { userIds: sellers.map((s) => s.userId) });
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestCatalog(catalog.categoryId);
  await deleteTestBrands([partBrand.id, maker.id]);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  await app?.close();
});

async function post<T>(url: string, body: object, token?: string): Promise<{ status: number; data: T; raw: string; code?: string }> {
  const res = await app.inject({ method: 'POST', url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const json = res.json();
  return { status: res.statusCode, data: json.data as T, raw: res.body, code: json.code };
}

const counts = (v: BrowseView) => Object.fromEntries(v.children.map((c) => [c.name, c.liveCount]));

describe('POST /discover/browse', () => {
  it('lists a node’s children with counts within the radius, hides empty ones, and gives crumbs', async () => {
    const { status, data } = await post<BrowseView>('/discover/browse', { parentId: catalog.categoryId, origin: GPS });
    expect(status).toBe(200);
    expect(data.node).toEqual({ id: catalog.categoryId, name: catalog.categoryName, level: 'machine_category' });
    expect(data.crumbs).toEqual([{ id: catalog.categoryId, name: catalog.categoryName }]);
    // p1, p2, p3, mach and the rented rental (rentals appear when kinds is empty); far and paused don't count.
    expect(counts(data)).toEqual({ 'Test Loom': 5 });
    expect(data.children[0]).toMatchObject({ id: catalog.machineTypeId, level: 'machine_type' });
    expect(data.children.some((c) => c.id === spinnerId)).toBe(false);
    expect(data.radiusKm).toBe(50);
  });

  it('counts part groups under a machine type, and popular brands (part, fitment and machine brands)', async () => {
    const { data } = await post<BrowseView>('/discover/browse', { parentId: catalog.machineTypeId, origin: GPS });
    expect(data.crumbs.map((c) => c.id)).toEqual([catalog.categoryId, catalog.machineTypeId]);
    expect(counts(data)).toEqual({ 'Test Temples': 2, 'Test Motors': 1 });
    expect(data.popularBrands).toEqual([
      { id: maker.id, name: maker.name, liveCount: 5 },
      { id: partBrand.id, name: partBrand.name, liveCount: 1 },
    ]);
  });

  it('counts All India with a null radius, and filters by kinds', async () => {
    const all = await post<BrowseView>('/discover/browse', { parentId: catalog.machineTypeId, origin: GPS, radiusKm: null });
    expect(counts(all.data)).toEqual({ 'Test Temples': 3, 'Test Motors': 1 });
    expect(all.data.radiusKm).toBeNull();

    const parts = await post<BrowseView>('/discover/browse', { parentId: catalog.categoryId, origin: GPS, kinds: ['part'] });
    expect(counts(parts.data)).toEqual({ 'Test Loom': 3 });
    const machines = await post<BrowseView>('/discover/browse', { parentId: catalog.machineTypeId, origin: GPS, kinds: ['machine'] });
    expect(machines.data.children).toEqual([]);
    expect(machines.data.popularBrands).toEqual([{ id: maker.id, name: maker.name, liveCount: 1 }]);
  });

  it('lists the roots without a parent, and answers 404 for an unknown node', async () => {
    const { data } = await post<BrowseView>('/discover/browse', { origin: GPS });
    expect(data.node).toBeNull();
    expect(data.crumbs).toEqual([]);
    expect(data.children.find((c) => c.id === catalog.categoryId)?.liveCount).toBe(5);
    const missing = await post('/discover/browse', { parentId: randomUUID() });
    expect(missing.status).toBe(404);
    const bad = await post('/discover/browse', { parentId: catalog.categoryId, extra: 1 });
    expect(bad.status).toBe(400);
  });

  it('answers 404 for an inactive node and for an active node under an inactive ancestor', async () => {
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, spinnerId));
    try {
      expect((await post('/discover/browse', { parentId: spinnerId })).status).toBe(404);
    } finally {
      await db.update(categories).set({ isActive: true }).where(eq(categories.id, spinnerId));
    }
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, catalog.categoryId));
    try {
      expect((await post('/discover/browse', { parentId: catalog.machineTypeId })).status).toBe(404);
      expect((await post('/discover/browse', { parentId: catalog.partGroupId })).status).toBe(404);
    } finally {
      await db.update(categories).set({ isActive: true }).where(eq(categories.id, catalog.categoryId));
    }
    expect((await post('/discover/browse', { parentId: catalog.machineTypeId })).status).toBe(200);
  });
});

describe('POST /discover/browse/brand', () => {
  it('lists the brand’s models with counts (brand-wide fitments fit every model) and the brand’s total', async () => {
    const { status, data } = await post<BrandBrowseView>('/discover/browse/brand', { brandId: maker.id, origin: GPS });
    expect(status).toBe(200);
    expect(data.brand).toEqual({ id: maker.id, name: maker.name });
    expect(data.models).toEqual([
      { id: m1, name: `Zb M1 ${catalog.suffix}`, liveCount: 2 },
      { id: m2, name: `Zb M2 ${catalog.suffix}`, liveCount: 3 },
    ]);
    // Every listing of the brand in scope: p1, p2 (brand-wide), p3 ("Other" model text), mach, rented.
    expect(data.allCount).toBe(5);
  });

  it('allCount is the search total for the brandId filter (same origin, radius and kinds)', async () => {
    for (const [brandId, extra] of [
      [maker.id, {}],
      [maker.id, { kinds: ['part'] }],
      [maker.id, { kinds: ['machine_rental'] }],
      [maker.id, { radiusKm: null }],
      [partBrand.id, {}],
    ] as Array<[string, { kinds?: ListingKind[]; radiusKm?: null }]>) {
      const view = await post<BrandBrowseView>('/discover/browse/brand', { brandId, origin: GPS, ...extra });
      const found = await post<{ total: number; reading: { brand: { id: string } | null } }>('/discover/search', {
        origin: GPS, filters: { brandId, ...extra },
      });
      expect(found.status).toBe(200);
      expect(found.data.total, JSON.stringify(extra)).toBe(view.data.allCount);
      expect(found.data.reading.brand?.id).toBe(brandId);
    }
    expect((await post<BrandBrowseView>('/discover/browse/brand', { brandId: partBrand.id, origin: GPS })).data.allCount).toBe(1);
    const unknown = await post('/discover/search', { filters: { brandId: randomUUID() } });
    expect([unknown.status, unknown.code]).toEqual([400, 'FILTER_NOT_AVAILABLE']);
  });

  it('hides an inactive model', async () => {
    await db.update(machineModels).set({ isActive: false }).where(eq(machineModels.id, m1));
    try {
      const { data } = await post<BrandBrowseView>('/discover/browse/brand', { brandId: maker.id, origin: GPS });
      expect(data.models.map((m) => m.id)).toEqual([m2]);
      expect(data.allCount).toBe(5);
    } finally {
      await db.update(machineModels).set({ isActive: true }).where(eq(machineModels.id, m1));
    }
  });

  it('filters by kinds and radius, hides empty models, and answers 404 for an unknown brand', async () => {
    const parts = await post<BrandBrowseView>('/discover/browse/brand', { brandId: maker.id, origin: GPS, kinds: ['part'] });
    expect(parts.data.models.map((m) => [m.id, m.liveCount])).toEqual([[m1, 2], [m2, 1]]);
    const machines = await post<BrandBrowseView>('/discover/browse/brand', { brandId: maker.id, origin: GPS, kinds: ['machine'] });
    expect(machines.data.models.map((m) => [m.id, m.liveCount])).toEqual([[m2, 1]]);
    expect(machines.data.allCount).toBe(1);
    const all = await post<BrandBrowseView>('/discover/browse/brand', { brandId: maker.id, origin: GPS, radiusKm: null });
    expect(all.data.models.map((m) => [m.id, m.liveCount])).toEqual([[m1, 3], [m2, 3]]);
    expect((await post('/discover/browse/brand', { brandId: randomUUID() })).status).toBe(404);
    expect((await post('/discover/browse/brand', {})).status).toBe(400);
  });
});

describe('POST /discover/cards', () => {
  it('returns public cards in the given order, dropping non-public and unknown ids', async () => {
    const order = [ids.paused!, ids.p3!, randomUUID(), ids.p1!, ids.p3!, ids.rented!];
    const { status, data } = await post<ListingCard[]>('/discover/cards', { ids: order, origin: GPS });
    expect(status).toBe(200);
    expect(data.map((c) => c.id)).toEqual([ids.p3, ids.p1, ids.rented]);
    expect(data[0]!.distanceKm).toBe(5);
    expect(data[0]!.saved).toBeNull();
  });

  it('sets saved for the signed-in viewer only', async () => {
    await db.insert(savedListings).values({ userId: viewer.userId, listingId: ids.p1! });
    const mine = await post<ListingCard[]>('/discover/cards', { ids: [ids.p1!, ids.p2!] }, viewer.token);
    expect(mine.data.map((c) => c.saved)).toEqual([true, false]);
    const other = await post<ListingCard[]>('/discover/cards', { ids: [ids.p1!] }, seller.token);
    expect(other.data.map((c) => c.saved)).toEqual([false]);
  });

  it('refuses more than 20 ids and a bad id', async () => {
    const many = Array.from({ length: 21 }, () => randomUUID());
    expect((await post('/discover/cards', { ids: many })).status).toBe(400);
    expect((await post('/discover/cards', { ids: ['x'] })).status).toBe(400);
    expect((await post<ListingCard[]>('/discover/cards', { ids: [] })).data).toEqual([]);
  });
});

describe('privacy', () => {
  it('never replies with a point, coordinates or a pincode', async () => {
    const replies = [
      await post('/discover/browse', { parentId: catalog.machineTypeId, origin: GPS }),
      await post('/discover/browse/brand', { brandId: maker.id, origin: GPS }),
      await post('/discover/cards', { ids: [ids.p1!, ids.mach!], origin: GPS }),
    ];
    for (const r of replies) {
      expect(r.raw).not.toMatch(/"(lat|lng|point|pincode|searchPoint|addressLine)"/);
      expect(r.raw).not.toContain('990011');
    }
  });
});

describe('GET /categories?depth=1', () => {
  it('returns the roots only', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories?depth=1' });
    expect(res.statusCode).toBe(200);
    const roots = res.json().data as CategoryNode[];
    expect(roots.find((r) => r.id === catalog.categoryId)).toMatchObject({ name: catalog.categoryName, children: [] });
    for (const r of roots) {
      expect(r.level).toBe('machine_category');
      expect(r.children).toEqual([]);
    }
    const full = await app.inject({ method: 'GET', url: '/categories' });
    expect((full.json().data as CategoryNode[]).find((r) => r.id === catalog.categoryId)!.children.length).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/categories?depth=2' })).statusCode).toBe(400);
  });
});
