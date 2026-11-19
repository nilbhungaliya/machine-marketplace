import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { SearchPage, SearchRequest } from '@mpm/shared-types';
import { db } from '../src/db/index.js';
import { searchQueries, searchSynonyms } from '../src/db/schema.js';
import { normalizeSearchText } from '../src/services/discovery/normalize.js';
import { createReaderDictionaryLoader } from '../src/services/discovery/reader-dictionary.js';
import { refreshListingSearch } from '../src/services/discovery/search-text.js';
import { countSearch, search } from '../src/services/discovery/search.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestRedisKeys } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// F4 + F5 spec §5.3 step 2 / §5.4, amended 2026-11-19: a word synonym ADDS its words. "fender" hits a listing with
// "fender" OR one with "mudguard"; the group is one unit for AND, partial, widen, facets and count-only.

let redis: Redis;
let catalog: TestCatalog;
let seller: TestSeller;
let admin: { id: string; token: string };
const ids: Record<string, string> = {};
const QUERIES = ['fender', 'mudguard', 'bush', 'बुश', 'બુશ', 'rear fender', 'fender zzqxv', 'fender gear'];

// Listings ~150 km from FAR_ORIGIN, at NEAR.
const NEAR = { lat: 24.6, lng: 87.9 };
const NEAR_ORIGIN = { point: { lat: 24.6, lng: 87.9 } };
const FAR_ORIGIN = { point: { lat: 25.95, lng: 87.9 } };

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
  catalog = await createTestCatalog();
  admin = await createTestAdmin('category_manager');
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  for (const [term, words] of [
    ['fender', 'mudguard'],
    ['mudguard', 'fender'],
    ['bush', 'bushing'],
    ['बुश', 'bush'],
    ['બુશ', 'bush'],
  ] as const) {
    await db.insert(searchSynonyms).values({
      term, termNorm: normalizeSearchText(term), script: /[ऀ-ॿ]/.test(term) ? 'devanagari' : /[઀-૿]/.test(term) ? 'gujarati' : 'latin',
      targetKind: 'word', targetWord: words, createdBy: admin.id,
    });
  }
  for (const [name, title] of [
    ['fender', 'Front fender'],
    ['mudguard', 'Rear mudguard'],
    ['rubberBush', 'Rubber bush'],
    ['bushing', 'Bushing kit'],
    ['gear', 'Spur gear'],
  ] as const) {
    const r = await insertTestListing(db, {
      businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId, title, point: NEAR,
    });
    ids[name] = r.id;
  }
  await refreshListingSearch(db, Object.values(ids));
});

afterAll(async () => {
  await db.delete(searchQueries).where(inArray(searchQueries.normalized, QUERIES.map((q) => normalizeSearchText(q))));
  await deleteTestAdmins([admin.id]);
  await deleteTestBusinesses([seller.businessId]);
  await deleteTestSellerExtras([seller]);
  await deleteTestCatalog(catalog.categoryId);
  await deleteTestRedisKeys(redis);
  await redis.quit();
});

const deps = () => ({ redis, dictionary: createReaderDictionaryLoader() });
async function find(q: string, extra: Partial<SearchRequest> = {}): Promise<SearchPage> {
  return (await search(db, { q, filters: { categoryId: catalog.categoryId }, ...extra }, null, deps())) as SearchPage;
}
const idsOf = (p: SearchPage) => new Set(p.items.map((c) => c.id));
const named = (...ns: string[]) => new Set(ns.map((n) => ids[n]!));

describe('word synonyms add their words (OR group)', () => {
  it('"fender" finds a Fender listing and a Mudguard listing, and back', async () => {
    const page = await find('fender');
    expect(page.reading.wordGroups).toEqual([{ typed: ['fender'], alternatives: [['mudguard']] }]);
    expect(idsOf(page)).toEqual(named('fender', 'mudguard'));
    expect(page.total).toBe(2);
    expect(idsOf(await find('mudguard'))).toEqual(named('fender', 'mudguard'));
  });

  it('"bush" in English, Hindi and Gujarati finds "Rubber bush" and "Bushing"', async () => {
    for (const q of ['bush', 'बुश', 'બુશ']) expect(idsOf(await find(q)), q).toEqual(named('rubberBush', 'bushing'));
  });

  it('the group is AND-ed with the other words', async () => {
    expect(idsOf(await find('rear fender'))).toEqual(named('mudguard'));
  });

  it('partial: the group counts as one unit', async () => {
    const page = await find('fender zzqxv');
    expect(page.partial).toBe(true);
    expect(idsOf(page)).toEqual(named('fender', 'mudguard'));
    expect(await countSearch(db, { q: 'fender zzqxv', filters: { categoryId: catalog.categoryId } }, null, deps())).toEqual({ total: 0, partialTotal: 2 });
    expect(await countSearch(db, { q: 'fender gear', filters: { categoryId: catalog.categoryId } }, null, deps())).toEqual({ total: 0, partialTotal: 3 });
  });

  it('widen counts full matches of the group', async () => {
    const far = await find('fender', { origin: FAR_ORIGIN, filters: { categoryId: catalog.categoryId, radiusKm: 50 } });
    expect(far.items).toEqual([]);
    expect(far.widen).toEqual({ radiusKm: 200, count: 2 });
    const near = await find('fender', { origin: NEAR_ORIGIN, filters: { categoryId: catalog.categoryId, radiusKm: 10 } });
    expect(near.total).toBe(2);
  });

  it('facets count the group’s matches', async () => {
    const page = await find('fender');
    expect(page.facets!.kinds.part).toBe(2);
    expect(page.facets!.side.left + page.facets!.side.right + page.facets!.side.pair).toBe(0);
  });
});
