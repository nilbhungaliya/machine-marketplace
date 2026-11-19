import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, gt, like, sql } from 'drizzle-orm';
import type { SearchPage } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { searchQueries } from '../src/db/schema.js';
import { deleteOldSearchQueries, isPersonalQuery } from '../src/services/discovery/search-log.service.js';
import { refreshListingSearch } from '../src/services/discovery/search-text.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestDiscovery, deleteTestRedisKeys, testRunId, testTerm, testTermNorm } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// F4 + F5 spec §5.13, R14 (plan B1-5): the anonymous search log, its personal-data check and retention.

const runId = testRunId();
let app: FastifyInstance;
let catalog: TestCatalog;
let seller: TestSeller;
let idBefore = 0;
/** A query word only this suite's listings carry. */
const word = `qlog${runId}`;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  const ids: string[] = [];
  for (let i = 0; i < 21; i++) {
    const { id } = await insertTestListing(db, {
      businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.motorsGroupId,
      unitId: catalog.unitId, conditionId: catalog.conditionId, title: `Zzt ${word} gear ${i}`,
    });
    ids.push(id);
  }
  await refreshListingSearch(db, ids);
  const [last] = await db.select({ id: sql<number>`coalesce(max(${searchQueries.id}), 0)::int` }).from(searchQueries);
  idBefore = Number(last?.id ?? 0);
});

afterAll(async () => {
  await db.delete(searchQueries).where(gt(searchQueries.id, idBefore));
  await deleteTestDiscovery(runId);
  await deleteTestBusinesses([seller.businessId]);
  await deleteTestSellerExtras([seller]);
  await deleteTestCatalog(catalog.categoryId);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  await app?.close();
});

async function newRows() {
  return db.select().from(searchQueries).where(gt(searchQueries.id, idBefore)).orderBy(searchQueries.id);
}

describe('isPersonalQuery', () => {
  it.each([
    'rahul@gmail.com',
    '+91 98765 43210',
    '+919876543210',
    '919876543210',
    '09876543210',
    '9876543210',
    '98765-43210 bearing',
    'call 98765 43210 now',
    '1234 5678 9012',
    '123456789012',
    '24AAACC1234D1Z5',
    'gst 24aaacc1234d1z5 pump',
    'ABCDE1234F',
    'pan abcde1234f',
  ])('skips %s', (q) => {
    expect(isPersonalQuery(q)).toBe(true);
  });

  it.each([
    '123456789',
    '12345678901',
    '1987654321012',
    'bearing 6205',
    '6205-2rs',
    'jcb 3dx 2015',
    '5876543210', // 10 digits starting 5: not a mobile number
    'ab-123/x',
  ])('logs %s', (q) => {
    expect(isPersonalQuery(q)).toBe(false);
  });
});

describe('search log', () => {
  const post = (body: Record<string, unknown>, url = '/discover/search') => app.inject({ method: 'POST', url, payload: body });

  it('one row per first page with words; never for count-only, suggest or page 2', async () => {
    const res = await post({ q: `${word} gear`, filters: { kinds: ['part'] } });
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json().data as SearchPage;
    expect(page.nextCursor).not.toBeNull();
    expect(await newRows()).toMatchObject([{ normalized: `${word} gear`, words: 2, resultTotal: 21, kind: 'part' }]);

    expect((await post({ q: `${word} gear`, filters: { kinds: ['part'] }, cursor: page.nextCursor })).statusCode).toBe(200);
    expect((await post({ q: `${word} gear` }, '/discover/search/count')).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/discover/suggest?q=${word}` })).statusCode).toBe(200);
    expect((await post({})).statusCode).toBe(200); // no words: not logged
    expect(await newRows()).toHaveLength(1);
  });

  it('a personal query is not logged; a long numeric part number is', async () => {
    const before = (await newRows()).length;
    for (const q of ['rahul@gmail.com', '+91 98765 43210', '09876543210', '123456789012', '24AAACC1234D1Z5', 'ABCDE1234F']) {
      expect((await post({ q })).statusCode).toBe(200);
    }
    expect(await newRows()).toHaveLength(before);
    for (const q of ['123456789', '12345678901', '1987654321012']) expect((await post({ q })).statusCode).toBe(200);
    const rows = (await newRows()).slice(before).map((r) => r.normalized);
    expect(rows).toEqual(['123456789', '12345678901', '1987654321012']);
  });
});

describe('retention', () => {
  it('deletes rows older than 90 days only', async () => {
    const old = testTerm(runId, 'old').replace(/-/g, ' ');
    const keep = testTerm(runId, 'keep').replace(/-/g, ' ');
    await db.insert(searchQueries).values([
      { normalized: old, words: 1, resultTotal: 1, day: sql`(now() AT TIME ZONE 'Asia/Kolkata')::date - 91` },
      { normalized: keep, words: 1, resultTotal: 1, day: sql`(now() AT TIME ZONE 'Asia/Kolkata')::date - 90` },
    ]);
    expect(await deleteOldSearchQueries(db, { batchSize: 1 })).toBeGreaterThanOrEqual(1);
    const left = await db
      .select({ normalized: searchQueries.normalized })
      .from(searchQueries)
      .where(and(like(searchQueries.normalized, `${testTermNorm(runId)} %`)));
    expect(left.map((r) => r.normalized)).toEqual([keep]);
  });
});
