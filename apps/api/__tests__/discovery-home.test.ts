import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { HomeView, ListingKind, ListingStatus } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestDiscovery, deleteTestRedisKeys, testRunId } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// F4 + F5 spec §7 Home (plan B2-1): top items near you (business-category restriction only when it gives ≥ 4), rentals
// nearby with available first, kind tiles with counts within the radius, root categories.

const runId = testRunId();
let app: FastifyInstance;
let catA: TestCatalog;
let catB: TestCatalog;
let seller: TestSeller;
let viewerA: TestSeller;
let viewerB: TestSeller;
const sellers: TestSeller[] = [];

// A spot no other suite uses (Bihar); "near" is ~5 km away, "far" ~150 km.
const HERE = { lat: 25.3, lng: 86.5 };
const NEAR = { lat: 25.35, lng: 86.5 };
const FAR = { lat: 26.65, lng: 86.5 };
const GPS = { point: HERE };

const ids: Record<string, string> = {};
const DAY = 86_400_000;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catA = await createTestCatalog();
  catB = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catA.categoryId });
  viewerA = await createTestSeller({ machineCategoryId: catA.categoryId });
  viewerB = await createTestSeller({ machineCategoryId: catB.categoryId });
  sellers.push(seller, viewerA, viewerB);

  const add = async (
    name: string,
    o: { kind: ListingKind; cat: TestCatalog; status?: ListingStatus; at?: { lat: number; lng: number }; refreshedAt?: Date },
  ) => {
    const r = await insertTestListing(db, {
      businessId: seller.businessId,
      userId: seller.userId,
      kind: o.kind,
      status: o.status ?? 'live',
      categoryId: o.kind === 'part' ? o.cat.partGroupId : o.cat.machineTypeId,
      title: `Home ${name}`,
      searchPoint: o.at ?? NEAR,
      ...(o.refreshedAt ? { refreshedAt: o.refreshedAt } : {}),
    });
    ids[name] = r.id;
  };
  for (const n of ['a1', 'a2', 'a3', 'a4']) await add(n, { kind: 'part', cat: catA });
  for (const n of ['b1', 'b2']) await add(n, { kind: 'part', cat: catB });
  await add('bMachine', { kind: 'machine', cat: catB });
  await add('aFar', { kind: 'part', cat: catA, at: FAR });
  await add('aPaused', { kind: 'part', cat: catA, status: 'paused' });
  await add('rentOld', { kind: 'machine_rental', cat: catA, refreshedAt: new Date(Date.now() - 20 * DAY) });
  await add('rentRented', { kind: 'machine_rental', cat: catA, status: 'rented' });
  await add('rentFar', { kind: 'machine_rental', cat: catA, at: FAR });
});

afterAll(async () => {
  await deleteTestDiscovery(runId, { userIds: sellers.map((s) => s.userId) });
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestCatalog(catA.categoryId);
  await deleteTestCatalog(catB.categoryId);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  await app?.close();
});

async function home(body: object, token?: string): Promise<{ status: number; view: HomeView; raw: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/discover/home',
    payload: body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.statusCode, view: res.json().data as HomeView, raw: res.body };
}

const idSet = (cards: Array<{ id: string }>) => new Set(cards.map((c) => c.id));
const named = (...names: string[]) => new Set(names.map((n) => ids[n]!));
const tile = (v: HomeView, kind: ListingKind) => v.kindTiles.find((t) => t.kind === kind)?.count;

describe('POST /discover/home', () => {
  it('shows parts and machines near a guest within 50 km, kind tiles with counts, and root categories', async () => {
    const { status, view } = await home({ origin: GPS });
    expect(status).toBe(200);
    expect(view.radiusKm).toBe(50);
    expect(view.origin.source).toBe('gps');
    expect(idSet(view.topNearYou)).toEqual(named('a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'bMachine'));
    expect(view.kindTiles.map((t) => t.kind)).toEqual(['part', 'machine', 'machine_rental']);
    expect(tile(view, 'part')).toBe(6);
    expect(tile(view, 'machine')).toBe(1);
    expect(tile(view, 'machine_rental')).toBe(2);
    for (const c of view.topNearYou) {
      expect(c.distanceKm).toBe(5);
      expect(c.saved).toBeNull();
    }
    const roots = view.rootCategories.filter((r) => r.id === catA.categoryId || r.id === catB.categoryId);
    expect(roots).toEqual([
      { id: catA.categoryId, name: catA.categoryName, icon: 'factory' },
      { id: catB.categoryId, name: catB.categoryName, icon: 'factory' },
    ]);
  });

  it('lists rentals nearby with every available one before a rented one', async () => {
    const { view } = await home({ origin: GPS });
    expect(view.rentNearby.map((c) => c.id)).toEqual([ids.rentOld, ids.rentRented]);
    expect(view.rentNearby[1]!.tags).toEqual(['on_rent']);
  });

  it('counts All India when the radius is null, and without an origin', async () => {
    const all = await home({ origin: GPS, radiusKm: null });
    expect(all.view.radiusKm).toBeNull();
    expect(idSet(all.view.topNearYou).has(ids.aFar!)).toBe(true);
    expect(tile(all.view, 'part')).toBeGreaterThanOrEqual(7);
    expect(all.view.rentNearby.map((c) => c.id)).toContain(ids.rentFar);

    const none = await home({});
    expect(none.view.radiusKm).toBeNull();
    expect(none.view.origin).toEqual({ label: null, source: null });
    expect(tile(none.view, 'part')).toBeGreaterThanOrEqual(7);
    for (const c of none.view.topNearYou) expect(c.distanceKm).toBeNull();
  });

  it("restricts top items to the viewer business's machine categories when that gives at least 4", async () => {
    const { view } = await home({ origin: GPS }, viewerA.token);
    expect(idSet(view.topNearYou)).toEqual(named('a1', 'a2', 'a3', 'a4'));
    for (const c of view.topNearYou) expect(c.saved).toBe(false);
  });

  it('falls back to every category when the restriction gives fewer than 4', async () => {
    const { view } = await home({ origin: GPS }, viewerB.token);
    expect(idSet(view.topNearYou)).toEqual(named('a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'bMachine'));
  });

  it('refuses the business location for a guest, and an unknown body key', async () => {
    const guest = await app.inject({ method: 'POST', url: '/discover/home', payload: { origin: { business: true } } });
    expect(guest.statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/discover/home', payload: { radius: 5 } });
    expect(res.statusCode).toBe(400);
  });

  it('never replies with a point, coordinates or a pincode', async () => {
    const { raw } = await home({ origin: GPS });
    expect(raw).not.toMatch(/"(lat|lng|point|pincode|searchPoint|addressLine)"/);
    expect(raw).not.toContain('990011');
  });
});
