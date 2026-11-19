import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, gt, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { CountOnlyResult, SearchFilters, SearchPage, SearchRedirect } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db, type Db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { conditions, industrialAreas, listings, machineModels, searchQueries, templateFields, users } from '../src/db/schema.js';
import { pointSql, snappedKmSql } from '../src/services/discovery/distance.js';
import { refreshListingSearch } from '../src/services/discovery/search-text.js';
import { inSearchTransaction, search } from '../src/services/discovery/search.service.js';
import { createTestBrand, createTestCatalog, deleteTestBrands, deleteTestCatalog, type TestBrand, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestRedisKeys } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestListingOptions, type TestSeller } from './_helpers/test-listings.js';

// F4 + F5 spec §5.4–§5.11 (plan B1-4): matching, full / partial / widen, filters, order, facets, cursor, count-only.
// Every request is scoped to this suite's test catalogue (`categoryId`), so other rows can't leak in.

let app: FastifyInstance;
let catalog: TestCatalog;
let brand: TestBrand;
let modelId: string;
let otherConditionId: string;
let areaId: string;
let A: TestSeller; // GST verified
let B: TestSeller; // not verified
let C: TestSeller; // owner suspended
let logIdBefore = 0;

const O = { lat: 21.17, lng: 72.83 };
/** A point `km` north of the origin. */
const north = (km: number) => ({ lat: O.lat + km / 111.2, lng: O.lng });
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const ORIGIN = { point: O };

type Mk = Partial<TestListingOptions> & { title: string };
const L: Record<string, string> = {};
let hydraulicRef = 0;

async function mk(name: string, o: Mk): Promise<string> {
  const { id, ref } = await insertTestListing(db, {
    businessId: A.businessId,
    userId: A.userId,
    kind: 'part',
    categoryId: catalog.motorsGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity: '1',
    point: north(5),
    ...o,
  });
  await refreshListingSearch(db, [id]);
  L[name] = id;
  if (name === 'hydraulic') hydraulicRef = ref;
  return id;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  brand = await createTestBrand({ makesParts: true });
  const [model] = await db
    .insert(machineModels)
    .values({ key: `zq_model_${catalog.suffix}`, brandId: brand.id, machineTypeId: catalog.machineTypeId, name: `Zq Model ${catalog.suffix}` })
    .returning({ id: machineModels.id });
  modelId = model!.id;
  const [cond] = await db
    .insert(conditions)
    .values({ key: `test_cond2_${catalog.suffix}`, label: `Test condition two ${catalog.suffix}`, sortOrder: 9999 })
    .returning({ id: conditions.id });
  otherConditionId = cond!.id;
  const [area] = await db
    .insert(industrialAreas)
    .values({ name: `Test Search Estate ${catalog.suffix}`, city: 'Surat', state: 'Gujarat' })
    .returning({ id: industrialAreas.id });
  areaId = area!.id;
  await db.update(templateFields).set({ filterable: true }).where(inArray(templateFields.id, [catalog.fieldIds.templeType, catalog.fieldIds.frameWidth]));
  const [last] = await db.select({ id: sql<number>`coalesce(max(${searchQueries.id}), 0)::int` }).from(searchQueries);
  logIdBefore = Number(last?.id ?? 0);

  A = await createTestSeller({ machineCategoryId: catalog.categoryId, gst: true });
  B = await createTestSeller({ machineCategoryId: catalog.categoryId });
  C = await createTestSeller({ machineCategoryId: catalog.categoryId });

  // Typo, partial, part numbers, ref.
  await mk('hydraulic', { title: 'Hydraulic gear pump', partNumber: 'HG-4410' });
  // Widen + partial: one near listing with "spindle" only, one far listing with both words.
  await mk('spindleNear', { title: 'Spindle cover', point: north(3) });
  await mk('spindleFar', { title: 'Spindle bearing housing', point: north(80) });
  // Match weights.
  await mk('camTitle', { title: 'Treadle cam follower', refreshedAt: daysAgo(30) });
  await mk('camBody', { title: 'Treadle lever', fitments: [{ brandId: brand.id, modelOther: 'follower series' }] });
  await mk('pnExact', { title: 'Treadle part', partNumber: 'TR-5521', refreshedAt: daysAgo(30) });
  await mk('pnText', { title: 'Treadle TR5521 part' });

  // Filters ("bobbin").
  await mk('f1', {
    title: 'Bobbin holder one', pricePaise: 100_000, quantity: '5', delivery: ['ship'], industrialAreaId: areaId, videos: 1,
    fitments: [{ brandId: brand.id, modelId, yearFrom: 2010, yearTo: 2015 }],
  });
  await mk('f2', {
    businessId: B.businessId, userId: B.userId, title: 'Bobbin holder two', conditionId: otherConditionId, priceModel: 'on_request',
    pricePaise: null, state: 'Maharashtra', city: 'Pune',
  });
  await mk('f3', {
    kind: 'machine', categoryId: catalog.machineTypeId, title: 'Bobbin winder machine', city: 'Ahmedabad', specs: { frame_width: 120 },
    machine: { brandId: brand.id, modelId, year: 2012, hoursRun: 100 },
  });
  await mk('f4', {
    kind: 'machine_rental', categoryId: catalog.machineTypeId, title: 'Bobbin winder rental', specs: { frame_width: 200 },
    rental: { rateDayPaise: 200_000 }, machine: { brandId: brand.id, year: 2018, hoursRun: 50 },
  });
  // Fits machine ("clutch"): a brand-wide fitment fits every model of the brand; an "Other" model fits none.
  await mk('cModel', { title: 'Clutch plate model', fitments: [{ brandId: brand.id, modelId, yearFrom: 2010, yearTo: 2015 }] });
  await mk('cBrand', { title: 'Clutch plate brand wide', fitments: [{ brandId: brand.id }] });
  await mk('cOther', { title: 'Clutch plate other model', fitments: [{ brandId: brand.id, modelOther: 'x' }] });

  // Statuses ("pawl"): only the reserved one is public.
  await mk('pawlDraft', { title: 'Pawl spring draft', status: 'draft' });
  await mk('pawlPaused', { title: 'Pawl spring paused', status: 'paused' });
  await mk('pawlHidden', { title: 'Pawl spring hidden', status: 'hidden' });
  await mk('pawlReserved', { title: 'Pawl spring reserved', status: 'reserved' });
  await mk('pawlSuspended', { businessId: C.businessId, userId: C.userId, title: 'Pawl spring suspended owner' });
  await db.update(users).set({ status: 'suspended' }).where(eq(users.id, C.userId));

  // Spec select filter ("shed").
  await mk('g1', { categoryId: catalog.partGroupId, side: 'left', title: 'Shed temple ring', specs: { temple_type: 'ring' } });
  await mk('g2', { categoryId: catalog.partGroupId, side: 'right', title: 'Shed temple plain' });

  // Side tiers ("shuttle"): the Pairs are better on every key, the Lefts still come first.
  await mk('sl1', { categoryId: catalog.partGroupId, side: 'left', title: 'Shuttle box lever', point: north(30), refreshedAt: daysAgo(10), pricePaise: 900_000 });
  await mk('sl2', { categoryId: catalog.partGroupId, side: 'left', title: 'Shuttle tongue spring', point: north(40), refreshedAt: daysAgo(20), pricePaise: 800_000 });
  // sp1 is the most expensive and sp2 the cheapest, so either price sort would put a Pair first without the tier.
  await mk('sp1', { categoryId: catalog.partGroupId, side: 'pair', title: 'Shuttle box shuttle', point: north(2), pricePaise: 10_000_000 });
  await mk('sp2', { categoryId: catalog.partGroupId, side: 'pair', title: 'Shuttle guard', point: north(1), pricePaise: 50_000 });
  await mk('sr', { categoryId: catalog.partGroupId, side: 'right', title: 'Shuttle picker', point: north(1) });

  // Rentals ("rapier"): the rented one is better on every key.
  await mk('ra', {
    kind: 'machine_rental', categoryId: catalog.machineTypeId, title: 'Rapier loom rental', point: north(40), refreshedAt: daysAgo(20),
    rental: { rateDayPaise: 900_000 }, machine: { year: 2000, hoursRun: 9000 },
  });
  await mk('rr', {
    kind: 'machine_rental', status: 'rented', categoryId: catalog.machineTypeId, title: 'Rapier loom rented', point: north(1),
    rental: { rateDayPaise: 100_000 }, machine: { year: 2020, hoursRun: 10 },
  });
  // The most expensive rental is rented too, so price_desc would put a rented one first without the tier.
  await mk('rr2', {
    kind: 'machine_rental', status: 'rented', categoryId: catalog.machineTypeId, title: 'Rapier loom rented dear', point: north(2),
    rental: { rateDayPaise: 5_000_000 }, machine: { year: 2019, hoursRun: 20 },
  });
  await mk('rm', { kind: 'machine', categoryId: catalog.machineTypeId, title: 'Rapier loom machine', machine: { year: 2015 } });

  // Nearest ties ("heald"): same point, fresher first.
  await mk('h2', { title: 'Heald frame two', point: north(7), refreshedAt: daysAgo(5) });
  await mk('h1', { title: 'Heald frame one', point: north(7) });
  await mk('h3', { title: 'Heald frame three', point: north(7), refreshedAt: daysAgo(15) });

  // Radius ("pirn"): one at ≤ 50 km, one whose snapped km is 51 (inside the raw 53 km margin).
  await mk('pirn50', { title: 'Pirn winder spare', point: north(49) });
  await mk('pirn51', { title: 'Pirn winder spare far', point: north(51.72) });

  // Paging ("ratchet"): 25 listings.
  for (let i = 0; i < 25; i++) await mk(`ratchet${i}`, { title: `Ratchet wheel ${i}`, refreshedAt: new Date(Date.now() - i * 60_000) });
});

afterAll(async () => {
  await db.delete(searchQueries).where(gt(searchQueries.id, logIdBefore));
  await deleteTestBusinesses([A.businessId, B.businessId, C.businessId]);
  await deleteTestSellerExtras([A, B, C]);
  await db.delete(industrialAreas).where(eq(industrialAreas.id, areaId));
  await db.delete(conditions).where(eq(conditions.id, otherConditionId));
  await deleteTestBrands([brand.id]);
  await deleteTestCatalog(catalog.categoryId);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  await app?.close();
});

const scoped = (filters: SearchFilters = {}): SearchFilters => ({ categoryId: catalog.categoryId, ...filters });

async function post(body: Record<string, unknown>, url = '/discover/search') {
  return app.inject({ method: 'POST', url, payload: body });
}

async function S(body: Record<string, unknown>): Promise<SearchPage> {
  const res = await post({ ...body, filters: scoped(body.filters as SearchFilters | undefined) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as SearchPage;
}

const idsOf = (p: SearchPage) => p.items.map((i) => i.id);
const names = (...n: string[]) => n.map((x) => L[x]!);
const sameSet = (p: SearchPage, ...n: string[]) => expect([...idsOf(p)].sort()).toEqual([...names(...n)].sort());

describe('matching', () => {
  it('a typo of a 5+ letter word still finds the listing (word similarity ≥ 0.6)', async () => {
    const p = await S({ q: 'hydraulik' });
    sameSet(p, 'hydraulic');
    expect(p.partial).toBe(false);
    expect(p.total).toBe(1);
  });

  it('partial: no full match, half the words hit with one in the title → partial results', async () => {
    const p = await S({ q: 'hydraulic gear valve flange' });
    expect(p.partial).toBe(true);
    sameSet(p, 'hydraulic');
    expect(p.total).toBe(1);
  });

  it('partial still requires every part number', async () => {
    const missing = await S({ q: 'hydraulic valve XY9999' });
    expect(missing.partial).toBe(false);
    expect(missing.items).toEqual([]);
    expect(missing.total).toBe(0);
    const present = await S({ q: 'hydraulic valve HG4410' });
    expect(present.partial).toBe(true);
    sameSet(present, 'hydraulic');
  });

  it('a part number matches typed with spaces or dashes', async () => {
    sameSet(await S({ q: 'HG 4410' }), 'hydraulic');
    sameSet(await S({ q: 'hg-4410' }), 'hydraulic');
  });

  it('widen counts full matches beyond the radius and is shown with partial results', async () => {
    const p = await S({ q: 'spindle bearing', origin: ORIGIN, filters: { radiusKm: 10 } });
    expect(p.widen).toEqual({ radiusKm: 100, count: 1 });
    expect(p.partial).toBe(true);
    sameSet(p, 'spindleNear');
  });

  it('empty with widen: nothing full or partial within the radius', async () => {
    const p = await S({ q: 'bearing housing', origin: ORIGIN, filters: { radiusKm: 10 } });
    expect(p.items).toEqual([]);
    expect(p.total).toBe(0);
    expect(p.partial).toBe(false);
    expect(p.widen).toEqual({ radiusKm: 100, count: 1 });
  });

  it('best match: a title hit beats a hit elsewhere, an exact part number beats its text form', async () => {
    const words = await S({ q: 'treadle follower' });
    expect(idsOf(words)).toEqual(names('camTitle', 'camBody'));
    const pn = await S({ q: 'TR5521' });
    expect(idsOf(pn)).toEqual(names('pnExact', 'pnText'));
  });

  it('#ref redirects to the listing; a bare ref adds refSuggestion and searches normally', async () => {
    const redirect = await S({ q: `#${hydraulicRef}` });
    expect(redirect as unknown as SearchRedirect).toEqual({ redirect: { listingId: L.hydraulic } });
    const bare = await S({ q: String(hydraulicRef) });
    expect(bare.refSuggestion).toEqual({ listingId: L.hydraulic, ref: hydraulicRef });
    expect(bare.items).toEqual([]);
  });

  it('a role-level threshold of 0.9 does not change results: the transaction sets 0.6', async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    pool.on('connect', (client) => {
      void client.query('SET pg_trgm.word_similarity_threshold = 0.9');
    });
    try {
      const strict = drizzle(pool, { schema }) as unknown as Db;
      const { rows } = await strict.execute<{ hit: boolean }>(sql`SELECT 'hydraulik' <% 'hydraulic gear pump' AS hit`);
      expect(rows[0]!.hit).toBe(false);
      const p = (await search(strict, { q: 'hydraulik', filters: scoped() }, null, { redis: app.redis })) as SearchPage;
      expect(idsOf(p)).toEqual(names('hydraulic'));
      // set_config(..., true) is local to the search's transaction: the connection is back to its own setting.
      const { rows: after } = await strict.execute<{ t: string }>(sql`SELECT current_setting('pg_trgm.word_similarity_threshold') AS t`);
      expect(after[0]!.t).toBe('0.9');
    } finally {
      await pool.end();
    }
  });
});

describe('transaction and visibility', () => {
  it('the search transaction is read-only and sets its own threshold', async () => {
    const seen = await inSearchTransaction(db, 0.6, async (tx) => {
      const { rows } = await tx.execute<{ ro: string; t: string }>(
        sql`SELECT current_setting('transaction_read_only') AS ro, current_setting('pg_trgm.word_similarity_threshold') AS t`,
      );
      return rows[0]!;
    });
    expect(seen).toEqual({ ro: 'on', t: '0.6' });
  });

  it('draft, paused, hidden and suspended-owner listings never show; a reserved one does, tagged', async () => {
    const p = await S({ q: 'pawl' });
    sameSet(p, 'pawlReserved');
    expect(p.items[0]!.tags).toContain('reserved');
  });
});

describe('filters', () => {
  const bobbin = async (filters: SearchFilters, extra: Record<string, unknown> = {}) => S({ q: 'bobbin', filters, ...extra });

  it('kinds and category', async () => {
    sameSet(await bobbin({ kinds: ['part'] }), 'f1', 'f2');
    sameSet(await bobbin({ kinds: ['machine'] }), 'f3');
    sameSet(await bobbin({ kinds: ['machine_rental'] }), 'f4');
    sameSet(await bobbin({ categoryId: catalog.motorsGroupId }), 'f1', 'f2');
    sameSet(await bobbin({}), 'f1', 'f2', 'f3', 'f4');
  });

  it('fits machine: brand, model and year (fitment range or machine year)', async () => {
    sameSet(await bobbin({ fit: { brandId: brand.id } }), 'f1', 'f3', 'f4');
    sameSet(await bobbin({ fit: { brandId: brand.id, modelId } }), 'f1', 'f3');
    sameSet(await bobbin({ fit: { brandId: brand.id, modelId, year: 2012 } }), 'f1', 'f3');
    sameSet(await bobbin({ fit: { brandId: brand.id, modelId, year: 2016 } }));
  });

  it('a brand-wide fitment fits every model of the brand (filter and model chip); an "Other" model does not', async () => {
    const clutch = async (filters: SearchFilters, q = 'clutch') => S({ q, filters });
    sameSet(await clutch({ fit: { brandId: brand.id, modelId } }), 'cModel', 'cBrand');
    sameSet(await clutch({ fit: { brandId: brand.id, modelId, year: 2012 } }), 'cModel', 'cBrand');
    sameSet(await clutch({ fit: { brandId: brand.id } }), 'cModel', 'cBrand', 'cOther');
    const chip = await clutch({}, `clutch zq model ${catalog.suffix}`);
    expect(chip.reading.model?.id).toBe(modelId);
    sameSet(chip, 'cModel', 'cBrand');
  });

  it('condition, place, quantity, seller, video', async () => {
    sameSet(await bobbin({ conditionIds: [otherConditionId] }), 'f2');
    sameSet(await bobbin({ states: ['Maharashtra'] }), 'f2');
    sameSet(await bobbin({ cities: ['pune', 'ahmedabad'] }), 'f2', 'f3');
    sameSet(await bobbin({ industrialAreaIds: [areaId] }), 'f1');
    sameSet(await bobbin({ minQty: 2 }), 'f1');
    sameSet(await bobbin({ gstVerifiedOnly: true }), 'f1', 'f3', 'f4');
    sameSet(await bobbin({ delivers: true }), 'f1');
    sameSet(await bobbin({ hasVideo: true }), 'f1');
  });

  it('price: per unit, rentals by the day rate, price on request passes unless hidden', async () => {
    sameSet(await bobbin({ priceMinPaise: 150_000 }), 'f2', 'f3', 'f4');
    sameSet(await bobbin({ priceMinPaise: 150_000, hidePriceOnRequest: true }), 'f3', 'f4');
    sameSet(await bobbin({ priceMaxPaise: 150_000 }), 'f1', 'f2');
    sameSet(await bobbin({ hidePriceOnRequest: true }), 'f1', 'f3', 'f4');
  });

  it('distance: within the radius of the origin; ignored without an origin', async () => {
    sameSet(await S({ q: 'spindle', origin: ORIGIN, filters: { radiusKm: 10 } }), 'spindleNear');
    sameSet(await S({ q: 'spindle', origin: ORIGIN, filters: { radiusKm: null } }), 'spindleNear', 'spindleFar');
    sameSet(await S({ q: 'spindle', filters: { radiusKm: 10 } }), 'spindleNear', 'spindleFar');
  });

  it('spec filters: select options and number ranges of the category in play; a blank value fails', async () => {
    sameSet(await S({ q: 'shed', filters: { categoryId: catalog.partGroupId, specs: { temple_type: ['ring'] } } }), 'g1');
    sameSet(await S({ q: 'bobbin', filters: { categoryId: catalog.machineTypeId, specs: { frame_width: { min: 150 } } } }), 'f4');
    sameSet(await S({ q: 'bobbin', filters: { categoryId: catalog.machineTypeId, specs: { frame_width: { max: 150 } } } }), 'f3');
  });

  it('400 FILTER_NOT_AVAILABLE for a field outside the category in play, a retired option, or no category', async () => {
    const cases = [
      { categoryId: catalog.categoryId, specs: { frame_width: { min: 1 } } },
      { categoryId: catalog.partGroupId, specs: { temple_type: ['roller'] } },
      { categoryId: catalog.partGroupId, specs: { nope: ['x'] } },
      { categoryId: catalog.machineTypeId, specs: { frame_width: ['wide'] } },
    ];
    for (const filters of cases) {
      const res = await post({ q: 'x', filters });
      expect(res.statusCode, JSON.stringify(filters)).toBe(400);
      expect(res.json().code).toBe('FILTER_NOT_AVAILABLE');
    }
    const none = await post({ q: 'x', filters: { specs: { temple_type: ['ring'] } } });
    expect(none.json().code).toBe('FILTER_NOT_AVAILABLE');
  });

  it('strict bodies: an unknown key or value is a 400', async () => {
    expect((await post({ q: 'x', filters: { colour: 'red' } })).statusCode).toBe(400);
    expect((await post({ q: 'x', extra: 1 })).statusCode).toBe(400);
    expect((await post({ q: 'x', filters: { radiusKm: 30 } })).statusCode).toBe(400);
    expect((await post({ q: 'x', filters: { minQty: 3 } })).statusCode).toBe(400);
    expect((await post({ q: 'x'.repeat(201) })).statusCode).toBe(400);
  });
});

describe('sorts', () => {
  it('nearest needs a location; year and hours need machine kinds only', async () => {
    const near = await post({ q: 'bobbin', sort: 'nearest' });
    expect(near.statusCode).toBe(400);
    expect(near.json().code).toBe('LOCATION_REQUIRED');
    for (const body of [{ sort: 'year_desc' }, { sort: 'hours_asc', filters: { kinds: ['part', 'machine'] } }]) {
      const res = await post({ q: 'bobbin', ...body });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('SORT_NEEDS_MACHINES');
    }
  });

  it('defaults: best match with words, nearest with an origin and no words, else newest', async () => {
    expect((await S({ q: 'bobbin' })).sort).toBe('best_match');
    expect((await S({ origin: ORIGIN })).sort).toBe('nearest');
    expect((await S({})).sort).toBe('newest');
  });

  it('each sort orders by its key', async () => {
    const machines = { kinds: ['machine', 'machine_rental'] as const };
    expect(idsOf(await S({ q: 'bobbin', sort: 'price_asc' }))).toEqual(names('f1', 'f4', 'f3', 'f2'));
    expect(idsOf(await S({ q: 'bobbin', sort: 'price_desc' }))).toEqual(names('f3', 'f4', 'f1', 'f2'));
    expect(idsOf(await S({ q: 'bobbin', sort: 'year_desc', filters: { ...machines } }))).toEqual(names('f4', 'f3'));
    expect(idsOf(await S({ q: 'bobbin', sort: 'hours_asc', filters: { ...machines } }))).toEqual(names('f4', 'f3'));
    expect(idsOf(await S({ q: 'treadle', sort: 'newest', filters: { kinds: ['part'] } })).slice(-2).sort()).toEqual(names('camTitle', 'pnExact').sort());
  });

  it('nearest ties on whole km are broken by relevance', async () => {
    expect(idsOf(await S({ q: 'heald', origin: ORIGIN, sort: 'nearest' }))).toEqual(names('h1', 'h2', 'h3'));
  });

  it('under Left every Left comes before every Pair, whatever the sort; the side facet equals the result count', async () => {
    for (const sort of ['best_match', 'nearest', 'newest', 'price_asc', 'price_desc'] as const) {
      const p = await S({ q: 'shuttle', sort, origin: ORIGIN, filters: { side: 'left' } });
      expect(p.items.map((i) => i.side), sort).toEqual(['left', 'left', 'pair', 'pair']);
      expect(p.total).toBe(4);
      expect(p.facets!.side).toEqual({ left: 4, right: 3, pair: 2 });
    }
  });

  it('an available rental comes before a rented one in every sort; rented only under All or For rent', async () => {
    for (const sort of ['best_match', 'nearest', 'newest', 'price_asc', 'price_desc', 'year_desc', 'hours_asc'] as const) {
      const p = await S({ q: 'rapier', sort, origin: ORIGIN, filters: { kinds: ['machine_rental'], radiusKm: null } });
      expect(idsOf(p)[0], sort).toBe(L.ra);
      expect(idsOf(p).slice(1).sort(), sort).toEqual(names('rr', 'rr2').sort());
    }
    const all = await S({ q: 'rapier', origin: ORIGIN, filters: { radiusKm: null } });
    expect(idsOf(all)).toContain(L.rr);
    expect(idsOf(all).slice(-2).sort()).toEqual(names('rr', 'rr2').sort());
    expect(all.facets!.kinds).toMatchObject({ machine: 1, machine_rental: 3 });
    const sale = await S({ q: 'rapier', filters: { kinds: ['machine'] } });
    sameSet(sale, 'rm');
    expect(sale.facets!.kinds).toMatchObject({ machine: 1, machine_rental: 3 });
  });
});

describe('facets', () => {
  it('each group is counted with every filter except its own', async () => {
    const p = await S({ q: 'bobbin', filters: { kinds: ['part'], gstVerifiedOnly: true } });
    sameSet(p, 'f1');
    expect(p.facets!.kinds).toEqual({ part: 1, machine: 1, machine_rental: 1 });
    expect(p.facets!.gstVerified).toBe(1);
    expect(p.facets!.delivers).toBe(1);
    expect(p.facets!.conditions).toEqual([{ id: catalog.conditionId, label: expect.any(String), count: 1 }]);

    const both = await S({ q: 'bobbin', filters: { kinds: ['part'], conditionIds: [otherConditionId] } });
    sameSet(both, 'f2');
    expect(both.facets!.conditions.map((c) => [c.id, c.count])).toEqual([
      [catalog.conditionId, 1],
      [otherConditionId, 1],
    ]);
    expect(both.facets!.states).toEqual([{ state: 'Maharashtra', count: 1 }]);
    expect(both.facets!.gstVerified).toBe(0);
  });

  it('spec facets of the category in play: option counts and number range', async () => {
    const shed = await S({ q: 'shed', filters: { categoryId: catalog.partGroupId, specs: { temple_type: ['ring'] } } });
    // Frame width (loom, parts and machines) is in play under the temples too; no shed listing has it.
    expect(shed.facets!.specs).toEqual([
      { key: 'frame_width', label: 'Frame width', type: 'number', unit: null, min: null, max: null },
      { key: 'temple_type', label: 'Temple type', type: 'select', options: [{ key: 'ring', label: 'Ring', count: 1 }] },
    ]);
    const looms = await S({ q: 'bobbin', filters: { categoryId: catalog.machineTypeId } });
    expect(looms.facets!.specs).toEqual([{ key: 'frame_width', label: 'Frame width', type: 'number', unit: null, min: 120, max: 200 }]);
  });

  it('facets on the first page only', async () => {
    const first = await S({ q: 'ratchet' });
    expect(first.facets).not.toBeNull();
    const second = await S({ q: 'ratchet', cursor: first.nextCursor });
    expect(second.facets).toBeNull();
    expect(second.total).toBeNull();
  });
});

describe('radius', () => {
  it('never shows a km above the radius', async () => {
    // Precondition: the far one's raw distance is inside the 3 km prefilter margin, its shown km above 50.
    const [far0] = await db
      .select({ km: snappedKmSql(listings.searchPoint, O), raw: sql<number>`ST_Distance(${listings.searchPoint}, ${pointSql(O)})` })
      .from(listings)
      .where(eq(listings.id, L.pirn51!));
    expect(Number(far0!.km)).toBeGreaterThan(50);
    expect(Number(far0!.raw)).toBeLessThan(53_000);
    const p50 = await S({ q: 'pirn', origin: ORIGIN, filters: { radiusKm: 50 } });
    expect(p50.items.every((i) => i.distanceKm !== null && i.distanceKm <= 50)).toBe(true);
    sameSet(p50, 'pirn50');
    const p100 = await S({ q: 'pirn', origin: ORIGIN, filters: { radiusKm: 100 } });
    sameSet(p100, 'pirn50', 'pirn51');
    const far = p100.items.find((i) => i.id === L.pirn51)!;
    expect(far.distanceKm).toBeGreaterThan(50);
  });
});

describe('cursor', () => {
  it('pages through without overlap', async () => {
    const first = await S({ q: 'ratchet' });
    expect(first.items.length).toBe(20);
    expect(first.total).toBe(25);
    const second = await S({ q: 'ratchet', cursor: first.nextCursor });
    expect(second.items.length).toBe(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...idsOf(first), ...idsOf(second)]).size).toBe(25);
  });

  it('tampered, swapped sort, swapped request or swapped origin → CURSOR_INVALID', async () => {
    const first = await S({ q: 'ratchet', sort: 'newest' });
    const c = first.nextCursor!;
    const flipped = c.slice(0, 10) + (c[10] === 'A' ? 'B' : 'A') + c.slice(11);
    const bad = [
      { q: 'ratchet', sort: 'newest', cursor: flipped, filters: scoped() },
      { q: 'ratchet', sort: 'price_asc', cursor: c, filters: scoped() },
      { q: 'ratchet wheel', sort: 'newest', cursor: c, filters: scoped() },
      { q: 'ratchet', sort: 'newest', cursor: c, filters: scoped({ kinds: ['part'] }) },
      { q: 'ratchet', sort: 'newest', cursor: c, filters: scoped(), origin: ORIGIN },
      { q: 'ratchet', sort: 'newest', cursor: 'not-a-cursor', filters: scoped() },
    ];
    for (const body of bad) {
      const res = await post(body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.json().code).toBe('CURSOR_INVALID');
    }
  });

  it('page 2 is stable after a renewal between pages: the renewed listing waits for a fresh search', async () => {
    const first = await S({ q: 'ratchet', sort: 'newest' });
    const onPage2 = (await S({ q: 'ratchet', sort: 'newest', cursor: first.nextCursor })).items.map((i) => i.id);
    const renewed = onPage2[0]!;
    // A renewal after page 1 (its refreshed_at is later than the cursor's asOf).
    await db.update(listings).set({ refreshedAt: new Date(Date.now() + 3_600_000) }).where(eq(listings.id, renewed));
    try {
      const second = await S({ q: 'ratchet', sort: 'newest', cursor: first.nextCursor });
      expect(idsOf(second)).toEqual(onPage2.filter((id) => id !== renewed));
      expect(idsOf(second).some((id) => idsOf(first).includes(id))).toBe(false);
    } finally {
      await db.update(listings).set({ refreshedAt: new Date() }).where(eq(listings.id, renewed));
    }
  });
});

describe('cursor asOf', () => {
  it('a listing refreshed after page 1 is left out of page 2 (refreshed_at <= asOf)', async () => {
    const asOf = new Date();
    const req = { q: 'ratchet', sort: 'price_asc' as const, filters: scoped() };
    const first = (await search(db, req, null, { redis: app.redis, now: () => asOf })) as SearchPage;
    expect(first.items.length).toBe(20);
    // The most expensive "ratchet", refreshed after asOf: price_asc would put it last, on page 2.
    const late = await mk('ratchetLate', { title: 'Ratchet wheel late', pricePaise: 99_000_000, refreshedAt: new Date(asOf.getTime() + 500) });
    try {
      const second = (await search(db, { ...req, cursor: first.nextCursor }, null, { redis: app.redis })) as SearchPage;
      expect(second.items.length).toBe(5);
      expect(idsOf(second)).not.toContain(late);
    } finally {
      // Out of every later "ratchet" search (deleted with the business in afterAll).
      await db.update(listings).set({ status: 'paused' }).where(eq(listings.id, late));
    }
  });
});

describe('count-only', () => {
  it('returns total, and partialTotal only when total is 0 with 2+ words', async () => {
    const zero = await post({ q: 'spindle bearing', origin: ORIGIN, filters: scoped({ radiusKm: 10 }) }, '/discover/search/count');
    expect(zero.statusCode, zero.body).toBe(200);
    expect(zero.json().data as CountOnlyResult).toEqual({ total: 0, partialTotal: 1 });
    const some = await post({ q: 'spindle', filters: scoped() }, '/discover/search/count');
    expect(some.json().data).toEqual({ total: 2, partialTotal: null });
    expect((await post({ q: 'x', cursor: 'abc' }, '/discover/search/count')).statusCode).toBe(400);
  });
});
