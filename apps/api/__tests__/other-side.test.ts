import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { OtherSideResult, PartSide } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { categories, machineModels, users } from '../src/db/schema.js';
import { createTestBrand, createTestCatalog, deleteTestBrands, deleteTestCatalog, type TestBrand, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import {
  createTestSeller,
  deleteTestSellerExtras,
  insertTestListing,
  type TestFitment,
  type TestListingOptions,
  type TestSeller,
} from './_helpers/test-listings.js';

// Other side (F2 plan Task 14, spec §9.1, R22, R54): three tiers, best match and count per side, the "possibly" label,
// public candidates only, distance ranking, and no private field in any card. Every test uses its own part group and
// part numbers unique to the run, so listings of other suites in the shared test database never match.

let app: FastifyInstance;
let catalog: TestCatalog;
let brand: TestBrand;
let modelA: string;
let modelB: string;
const sellers: TestSeller[] = [];

let seq = 0;
const uniq = () => `${Date.now().toString(36).toUpperCase()}${seq++}`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const otherSide = async (id: string, token?: string) =>
  app.inject({ method: 'GET', url: `/listings/${id}/other-side`, headers: token ? auth(token) : {} });
const result = async (id: string, token?: string): Promise<OtherSideResult> => {
  const res = await otherSide(id, token);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data;
};

async function seller(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: catalog.categoryId, ...opts });
  sellers.push(s);
  return s;
}

/** A part group of its own under the test loom (deleted with the catalogue). */
async function newGroup(): Promise<string> {
  const slug = `os-${uniq().toLowerCase()}`;
  const [row] = await db
    .insert(categories)
    .values({ parentId: catalog.machineTypeId, level: 'part_group', name: `OS ${slug}`, slug, path: `${catalog.categorySlug}/test-loom/${slug}` })
    .returning({ id: categories.id });
  return row!.id;
}

const part = (s: TestSeller, groupId: string, side: PartSide, extra: Partial<TestListingOptions> = {}) =>
  insertTestListing(db, {
    businessId: s.businessId,
    userId: s.userId,
    kind: 'part',
    status: 'live',
    categoryId: groupId,
    side,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity: '2',
    ...extra,
  }).then((r) => r.id);

function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) allKeys(v, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  brand = await createTestBrand({ makesMachines: true });
  const models = await db
    .insert(machineModels)
    .values([
      { key: `os_a_${uniq()}`, brandId: brand.id, machineTypeId: catalog.machineTypeId, name: 'OS Model A' },
      { key: `os_b_${uniq()}`, brandId: brand.id, machineTypeId: catalog.machineTypeId, name: 'OS Model B' },
    ])
    .returning({ id: machineModels.id });
  modelA = models[0]!.id;
  modelB = models[1]!.id;
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  if (brand) await deleteTestBrands([brand.id]);
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  await app?.close();
});

describe('tier 1: part numbers', () => {
  it('finds TP-…R for TP-…L through the side-stripped base, and an equal number on the other side', async () => {
    const s = await seller();
    const group = await newGroup();
    const u = uniq();
    const left = await part(s, group, 'left', { partNumber: `TP-${u}L`, title: 'Kqzv left' });
    const right = await part(s, group, 'right', { partNumber: `TP-${u}R`, title: 'Wxpt right' });
    const r = await result(left);
    expect(r.complement).toBe('right');
    expect(r.best.right).toMatchObject({ id: right, tier: 1, possible: false });
    expect(r.counts).toEqual({ right: 1, pair: 0 });
    expect(r.best.pair).toBeNull();

    const v = uniq();
    const abLeft = await part(s, group, 'left', { partNumber: `AB-${v}`, title: 'Jmnb' });
    const abRight = await part(s, group, 'right', { partNumber: `AB-${v}`, title: 'Ytrq' });
    const r2 = await result(abLeft);
    expect(r2.items.map((c) => c.id)).toEqual([abRight]);
    expect(r2.items[0]).toMatchObject({ tier: 1 });
  });

  it('returns a pair under best.pair', async () => {
    const s = await seller();
    const group = await newGroup();
    const u = uniq();
    const left = await part(s, group, 'left', { partNumber: `TP-${u}L` });
    const pair = await part(s, group, 'pair', { partNumber: `TP-${u}` });
    const r = await result(left);
    expect(r.best.pair).toMatchObject({ id: pair, tier: 1, side: 'pair' });
    expect(r.best.right).toBeNull();
    expect(r.counts).toEqual({ right: 0, pair: 1 });
  });

  it('keeps the pair in best and counts when 20 right-side matches fill the items', async () => {
    const s = await seller();
    const group = await newGroup();
    const u = uniq();
    const left = await part(s, group, 'left', { partNumber: `TP-${u}L` });
    for (let i = 0; i < 20; i++) await part(s, group, 'right', { partNumber: `TP-${u}R` });
    const pair = await part(s, group, 'pair', { partNumber: `TP-${u}` });
    const r = await result(left);
    expect(r.items).toHaveLength(20);
    expect(r.items.every((c) => c.side === 'right')).toBe(true);
    expect(r.best.pair).toMatchObject({ id: pair });
    expect(r.counts).toEqual({ right: 20, pair: 1 });
  });
});

describe('tiers 2 and 3: name and fit', () => {
  const fit = (f: Partial<TestFitment> = {}): TestFitment => ({ brandId: brand.id, ...f });

  it('matches the same group, a similar name and an overlapping model (tier 2), ranked before tier 3', async () => {
    const s = await seller();
    const group = await newGroup();
    const left = await part(s, group, 'left', { title: 'Temple roller assembly LH', fitments: [fit({ modelId: modelA, yearFrom: 2010, yearTo: 2015 })] });
    const t2 = await part(s, group, 'right', { title: 'Temple roller assembly RH', fitments: [fit({ modelId: modelA, yearFrom: 2014 })] });
    const t3 = await part(s, group, 'right', { title: 'Temple roller assembly (right)' });
    const r = await result(left);
    expect(r.items.map((c) => [c.id, c.tier, c.possible])).toEqual([
      [t2, 2, false],
      [t3, 3, true],
    ]);
    expect(r.best.right).toMatchObject({ id: t2 });
  });

  it('overlaps by a brand row with all models (tier 2)', async () => {
    const s = await seller();
    const group = await newGroup();
    const left = await part(s, group, 'left', { title: 'Picker arm left', fitments: [fit({ modelId: modelA })] });
    const right = await part(s, group, 'right', { title: 'Picker arm right', fitments: [fit()] });
    const r = await result(left);
    expect(r.items.map((c) => [c.id, c.tier])).toEqual([[right, 2]]);
  });

  it('excludes both-fitted listings that do not overlap (other years or other model)', async () => {
    const s = await seller();
    const group = await newGroup();
    const left = await part(s, group, 'left', { title: 'Shuttle box left', fitments: [fit({ modelId: modelA, yearFrom: 2000, yearTo: 2005 })] });
    await part(s, group, 'right', { title: 'Shuttle box right', fitments: [fit({ modelId: modelA, yearFrom: 2006 })] });
    await part(s, group, 'right', { title: 'Shuttle box right', fitments: [fit({ modelId: modelB })] });
    const r = await result(left);
    expect(r.items).toEqual([]);
    expect(r.counts).toEqual({ right: 0, pair: 0 });
  });

  it('labels a match where this listing has no fitment as possible (tier 3)', async () => {
    const s = await seller();
    const group = await newGroup();
    const left = await part(s, group, 'left', { title: 'Beam flange left' });
    const right = await part(s, group, 'right', { title: 'Beam flange right', fitments: [fit({ modelId: modelB })] });
    await part(s, group, 'right', { title: 'Completely different widget' });
    const r = await result(left);
    expect(r.items.map((c) => [c.id, c.tier, c.possible])).toEqual([[right, 3, true]]);
  });
});

describe('visibility and privacy', () => {
  it('never returns a paused candidate or one of a restricted business', async () => {
    const s = await seller();
    const suspended = await seller();
    const group = await newGroup();
    const u = uniq();
    const left = await part(s, group, 'left', { partNumber: `TP-${u}L` });
    await part(s, group, 'right', { partNumber: `TP-${u}R`, status: 'paused' });
    await part(suspended, group, 'right', { partNumber: `TP-${u}R` });
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, suspended.userId));
    const r = await result(left);
    expect(r.items).toEqual([]);
  });

  it('answers an empty result for a sideless part and a pair', async () => {
    const s = await seller();
    const group = await newGroup();
    const u = uniq();
    const none = await part(s, group, 'not_applicable', { partNumber: `TP-${u}` });
    const pair = await part(s, group, 'pair', { partNumber: `TP-${u}` });
    await part(s, group, 'right', { partNumber: `TP-${u}` });
    for (const id of [none, pair]) {
      expect(await result(id)).toEqual({ complement: null, best: {}, counts: {}, items: [] });
    }
  });

  it('ranks by distance from the viewer business point, else from the listing', async () => {
    const owner = await seller();
    const near = await seller();
    const far = await seller();
    const viewer = await seller({ point: { lat: 21.17, lng: 72.83 } });
    const group = await newGroup();
    const u = uniq();
    // The listing itself sits near the "far" seller, so the two origins give opposite orders.
    const left = await part(owner, group, 'left', { partNumber: `TP-${u}L`, point: { lat: 23.02, lng: 72.57 } });
    const nearId = await part(near, group, 'right', { partNumber: `TP-${u}R`, point: { lat: 21.2, lng: 72.84 } });
    const farId = await part(far, group, 'right', { partNumber: `TP-${u}R`, point: { lat: 23.0, lng: 72.6 } });

    const signedIn = await result(left, viewer.token);
    expect(signedIn.items.map((c) => c.id)).toEqual([nearId, farId]);
    expect(signedIn.items[0]!.distanceKm).toBeLessThan(10);
    const guest = await result(left);
    expect(guest.items.map((c) => c.id)).toEqual([farId, nearId]);
    expect(guest.items[0]!.distanceKm).toBeNull();
  });

  it('carries no point, pincode, address line or serial number in any card', async () => {
    const s = await seller();
    const group = await newGroup();
    const u = uniq();
    const left = await part(s, group, 'left', { partNumber: `TP-${u}L` });
    await part(s, group, 'right', {
      partNumber: `TP-${u}R`, locationSource: 'godown', pincode: '990017', addressLine: 'Plot 9, Hidden Road', point: { lat: 21.1, lng: 72.8 },
    });
    await part(s, group, 'pair', { partNumber: `TP-${u}`, pincode: '990018' });
    const res = await otherSide(left);
    const data = res.json().data as OtherSideResult;
    expect(data.items).toHaveLength(2);
    expect(data.best.right).not.toBeNull();
    const keys = allKeys(data);
    for (const k of ['point', 'pincode', 'addressLine', 'serialNumber', 'lat', 'lng']) expect(keys.has(k), k).toBe(false);
    expect(res.body).not.toContain('Hidden Road');
    expect(res.body).not.toContain('990017');
  });

  it('is 404 for a guest or another business on a draft, 200 for its owner', async () => {
    const s = await seller();
    const other = await seller();
    const group = await newGroup();
    const u = uniq();
    const draft = await part(s, group, 'left', { partNumber: `TP-${u}L`, status: 'draft' });
    const right = await part(other, group, 'right', { partNumber: `TP-${u}R` });
    expect((await otherSide(draft)).statusCode).toBe(404);
    const res = await otherSide(draft, other.token);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('LISTING_NOT_FOUND');
    const mine = await result(draft, s.token);
    expect(mine.best.right).toMatchObject({ id: right });
  });
});
