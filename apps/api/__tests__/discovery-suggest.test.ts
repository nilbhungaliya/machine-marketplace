import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Suggestion } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { categories, machineModels, searchQueries, searchSynonyms, searchTrendingHidden } from '../src/db/schema.js';
import { bumpReaderVersion } from '../src/services/discovery/reader-version.js';
import { refreshListingSearch } from '../src/services/discovery/search-text.js';
import { createSuggestCountLoader, fetchSuggestCounts, suggest } from '../src/services/discovery/suggest.service.js';
import { indiaDay, trending } from '../src/services/discovery/trending.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBrand, createTestCatalog, deleteTestBrands, deleteTestCatalog, type TestBrand, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestDiscovery, deleteTestRedisKeys, testRunId, testTerm, testTermNorm } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// F4 + F5 spec §5.12 (plan B1-5): suggestions with counts from a 90 s map, and trending.

const runId = testRunId();
let app: FastifyInstance;
let catalog: TestCatalog;
let brand: TestBrand;
let modelId: string;
let hydraulicId: string;
let seller: TestSeller;
let admin: { id: string; token: string };
let listingId: string;
let listingRef: number;
const synonym = testTerm(runId, 'tmpl');

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  brand = await createTestBrand({ makesParts: true });
  admin = await createTestAdmin('category_manager');
  const [model] = await db
    .insert(machineModels)
    .values({ key: `zq_model_${catalog.suffix}`, brandId: brand.id, machineTypeId: catalog.machineTypeId, name: `Zq Model ${catalog.suffix}` })
    .returning({ id: machineModels.id });
  modelId = model!.id;
  const [hyd] = await db
    .insert(categories)
    .values({
      parentId: catalog.machineTypeId, level: 'part_group', name: 'Hydraulic Pumps', slug: 'hydraulic-pumps',
      path: `${catalog.categorySlug}/test-loom/hydraulic-pumps`, sortOrder: 5,
    })
    .returning({ id: categories.id });
  hydraulicId = hyd!.id;
  await db.insert(searchSynonyms).values({
    term: synonym, termNorm: synonym.replace(/-/g, ' '), script: 'latin', targetKind: 'category', targetId: catalog.partGroupId, createdBy: admin.id,
  });
  await bumpReaderVersion(app.redis);

  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  const base = {
    businessId: seller.businessId, userId: seller.userId, kind: 'part' as const, unitId: catalog.unitId, conditionId: catalog.conditionId,
    point: { lat: 21.2, lng: 72.8 },
  };
  const one = await insertTestListing(db, {
    ...base, categoryId: catalog.partGroupId, side: 'left', title: 'Temple ring left',
    fitments: [{ brandId: brand.id, modelId }],
  });
  const two = await insertTestListing(db, { ...base, categoryId: hydraulicId, title: 'Gear pump' });
  await refreshListingSearch(db, [one.id, two.id]);
  listingId = one.id;
  listingRef = one.ref;
});

afterAll(async () => {
  await deleteTestDiscovery(runId, { adminIds: [admin.id] });
  await deleteTestBusinesses([seller.businessId]);
  await deleteTestSellerExtras([seller]);
  await deleteTestAdmins([admin.id]);
  await deleteTestBrands([brand.id]);
  await deleteTestCatalog(catalog.categoryId);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  await app?.close();
});

async function get(q: string): Promise<Suggestion[]> {
  const res = await app.inject({ method: 'GET', url: `/discover/suggest?q=${encodeURIComponent(q)}` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as Suggestion[];
}

describe('GET /discover/suggest', () => {
  it('a part group by name prefix, with its path and public count', async () => {
    const out = await get('test temp');
    expect(out).toContainEqual({
      type: 'category', id: catalog.partGroupId, name: 'Test Temples', path: [catalog.categoryName, 'Test Loom'], liveCount: 1,
    });
  });

  it('a typo at word similarity 0.5 ("hydralic")', async () => {
    const out = await get('hydralic');
    expect(out.map((s) => s.id)).toContain(hydraulicId);
  });

  it('a category synonym', async () => {
    const out = await get(synonym);
    expect(out.map((s) => s.id)).toContain(catalog.partGroupId);
  });

  it('brands and models, with the model under its brand', async () => {
    const brands = await get(brand.name);
    expect(brands).toContainEqual({ type: 'brand', id: brand.id, name: brand.name, path: [], liveCount: 1 });
    const models = await get(`zq model ${catalog.suffix}`);
    expect(models).toContainEqual({ type: 'model', id: modelId, name: `Zq Model ${catalog.suffix}`, path: [brand.name], liveCount: 1 });
  });

  it('a listing entry for a public ref, bare or with #', async () => {
    for (const q of [String(listingRef), `#${listingRef}`]) {
      const out = await get(q);
      expect(out[0]).toEqual({ type: 'listing', id: listingId, name: 'Temple ring left', path: [], liveCount: 1, ref: listingRef });
    }
  });

  it('zero-count entries are dropped; under 2 characters answers nothing', async () => {
    expect((await get('test motors')).map((s) => s.id)).not.toContain(catalog.motorsGroupId);
    expect(await get('t')).toEqual([]);
    expect(await get('  ')).toEqual([]);
  });

  it('counts come from a map re-read at most every 90 s', async () => {
    const spy = vi.fn(fetchSuggestCounts);
    const loader = createSuggestCountLoader(spy);
    let now = 1_000_000;
    const clock = () => now;
    const count = async () => (await suggest(db, 'test temp', { counts: loader, now: clock })).find((s) => s.id === catalog.partGroupId)?.liveCount;
    expect(await count()).toBe(1);
    const extra = await insertTestListing(db, {
      businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId, side: 'right',
      unitId: catalog.unitId, conditionId: catalog.conditionId, title: 'Temple ring right',
    });
    await refreshListingSearch(db, [extra.id]);
    now += 89_999;
    expect(await count()).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await count()).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('strict query: an unknown parameter is a 400', async () => {
    expect((await app.inject({ method: 'GET', url: '/discover/suggest?q=ab&x=1' })).statusCode).toBe(400);
  });
});

describe('trending', () => {
  const NOW = new Date('2026-11-19T10:00:00Z');
  const day = (n: number) => indiaDay(new Date(NOW.getTime() - n * 86_400_000));
  const term = (s: string) => `${testTermNorm(runId)} ${s}`;

  /** `searches` rows of a query spread over the given days ago. */
  async function seed(q: string, daysAgo: number[], resultTotal = 3) {
    await db.insert(searchQueries).values(daysAgo.map((d) => ({ normalized: q, words: 3, resultTotal, kind: null, day: day(d) })));
  }

  beforeAll(async () => {
    await seed(term('hit'), [0, 0, 3, 6, 6]); // 5 searches, 3 days: in
    await seed(term('top'), [0, 1, 1, 2, 2, 2]); // 6 searches, 3 days: in, first
    await seed(term('two days'), [0, 0, 1, 1, 1, 1]); // 2 days: out
    await seed(term('four'), [0, 1, 2, 2]); // 4 searches: out
    await seed(term('old'), [0, 1, 7, 7, 7]); // day 7 is outside the window: 2 days: out
    await seed(term('empty'), [0, 1, 2, 3, 4], 0); // found nothing: out
    await seed(term('hidden'), [0, 1, 2, 3, 4]); // hidden: out
    await db.insert(searchTrendingHidden).values({ normalized: term('hidden'), createdBy: admin.id });
  });

  it('≥ 3 distinct days and ≥ 5 searches in the last 7 days, results > 0, not hidden; most searched first', async () => {
    const out = (await trending(db, { now: NOW })).filter((q) => q.startsWith(testTermNorm(runId)));
    expect(out).toEqual([term('top'), term('hit')]);
  });

  it('a day later the oldest day drops out of the window', async () => {
    const later = new Date(NOW.getTime() + 86_400_000);
    const out = (await trending(db, { now: later })).filter((q) => q.startsWith(testTermNorm(runId)));
    // "hit" had searches 6 days ago; now 7 days ago: 3 searches over 2 days.
    expect(out).toEqual([term('top')]);
  });

  it('GET /discover/trending answers a list', async () => {
    const res = await app.inject({ method: 'GET', url: '/discover/trending' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it('indiaDay is the IST calendar day', () => {
    expect(indiaDay(new Date('2026-11-19T18:29:59Z'))).toBe('2026-11-19');
    expect(indiaDay(new Date('2026-11-19T18:30:00Z'))).toBe('2026-11-20');
  });
});

