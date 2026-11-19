import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { businesses, conditions, listings, searchRefreshJobs } from '../src/db/schema.js';
import { updateCategory } from '../src/services/catalog/category-admin.service.js';
import { backfillSearch, runSearchRefresh, runSearchRefreshTick } from '../src/services/discovery/refresh-jobs.js';
import { createReaderDictionaryLoader } from '../src/services/discovery/reader-dictionary.js';
import { readQuery } from '../src/services/discovery/query-reader.js';
import { readReaderVersion } from '../src/services/discovery/reader-version.js';
import { refreshListingSearch } from '../src/services/discovery/search-text.js';
import { adminPatchListing } from '../src/services/listings/listing-admin.service.js';
import { applySellerAction, publishListing } from '../src/services/listings/listing-lifecycle.service.js';
import { syncBusinessListings } from '../src/services/listings/listing-validate.service.js';
import { createListing, patchListing } from '../src/services/listings/listing-write.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBrand, createTestCatalog, deleteTestBrands, deleteTestCatalog, type TestBrand, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestDiscovery, deleteTestRedisKeys, testRunId } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// F4 + F5 spec §5.2, §5.3 (plan B1-2): listing writes rebuild the search columns in their transaction; catalogue
// changes bump the reader version after commit and queue a background rebuild; the job, its retries and the backfill.

const runId = testRunId();
let app: FastifyInstance;
let catalog: TestCatalog;
let seller: TestSeller;
let brand: TestBrand;
let manager: { id: string; token: string };
const createdConditionIds: string[] = [];
const createdBrandIds: string[] = [];

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  brand = await createTestBrand({ makesParts: true });
  manager = await createTestAdmin('category_manager');
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId, gst: true, pincode: '990025', pincodeOffices: [{ lat: 19.5, lng: 74.5 }] });
});

afterAll(async () => {
  await deleteTestDiscovery(runId, { adminIds: [manager.id], scopeIds: [catalog.categoryId, brand.id, ...createdBrandIds, ...createdConditionIds] });
  await deleteTestBusinesses([seller.businessId]);
  await deleteTestSellerExtras([seller]);
  await deleteTestAdmins([manager.id]);
  await deleteTestBrands([brand.id, ...createdBrandIds]);
  if (createdConditionIds.length) await db.delete(conditions).where(inArray(conditions.id, createdConditionIds));
  await deleteTestCatalog(catalog.categoryId);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  await app?.close();
});

const user = () => ({ userId: seller.userId, businessId: seller.businessId });

async function refreshedAt(id: string): Promise<Date | null> {
  const [row] = await db.select({ at: listings.searchRefreshedAt }).from(listings).where(eq(listings.id, id));
  return row?.at ?? null;
}

async function texts(id: string) {
  const [row] = await db.select({ title: listings.searchTitleText, text: listings.searchText }).from(listings).where(eq(listings.id, id));
  return row!;
}

/** A fresh listing whose search time is set far in the past, so any refresh moves it. */
async function staleListing(extra: Partial<Parameters<typeof insertTestListing>[1]> = {}): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: catalog.partGroupId,
    side: 'left',
    title: 'Zzt Refresh Part',
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity: '2',
    pincode: '990025',
    ...extra,
  });
  await db.update(listings).set({ searchRefreshedAt: new Date('2020-01-01T00:00:00Z') }).where(eq(listings.id, id));
  return id;
}

const moved = async (id: string) => {
  const at = await refreshedAt(id);
  expect(at).not.toBeNull();
  expect(at!.getTime()).toBeGreaterThan(new Date('2021-01-01T00:00:00Z').getTime());
};

describe('listing write paths rebuild the search columns', () => {
  it('create', async () => {
    const view = await db.transaction((tx) => createListing(tx, user(), { kind: 'part' }));
    expect(await refreshedAt(view.id)).not.toBeNull();
  });

  it.each([
    ['title', { title: 'Zzt Retitled Spindle' }, 'zzt retitled spindle'],
    ['part number', { partNumber: 'QQ-77/Z' }, 'qq77z'],
    ['specs', { specs: { temple_type: 'ring' } }, 'ring'],
    ['category', { categoryId: 'MOTORS' }, 'test motors'],
  ] as const)('patch %s', async (_name, patch, expected) => {
    const id = await staleListing({ status: 'draft', side: 'not_applicable' });
    const body = 'categoryId' in patch ? { categoryId: catalog.motorsGroupId } : patch;
    await db.transaction((tx) => patchListing(tx, user(), id, body));
    await moved(id);
    expect((await texts(id)).text).toContain(expected);
  });

  it('patch part brand and fitments', async () => {
    const id = await staleListing({ status: 'draft' });
    await db.transaction((tx) => patchListing(tx, user(), id, { partBrandId: brand.id }));
    await moved(id);
    expect((await texts(id)).title).toContain(brand.name.toLowerCase());
    await db.update(listings).set({ searchRefreshedAt: new Date('2020-01-01T00:00:00Z') }).where(eq(listings.id, id));
    await db.transaction((tx) => patchListing(tx, user(), id, { fitments: [{ brandId: brand.id, modelId: null, modelOther: 'Zzt Fitother', yearFrom: null, yearTo: null, note: null }] }));
    await moved(id);
    expect((await texts(id)).text).toContain('zzt fitother');
  });

  it('patch machine details', async () => {
    const { id } = await insertTestListing(db, {
      businessId: seller.businessId, userId: seller.userId, kind: 'machine', status: 'draft', categoryId: catalog.machineTypeId, title: 'Zzt Machine',
    });
    await db.update(listings).set({ searchRefreshedAt: new Date('2020-01-01T00:00:00Z') }).where(eq(listings.id, id));
    await db.transaction((tx) => patchListing(tx, user(), id, { machine: { brandOther: 'Zzt Makerother' } }));
    await moved(id);
    expect((await texts(id)).text).toContain('zzt makerother');
  });

  it('patch location (the search point follows)', async () => {
    const id = await staleListing({ status: 'draft' });
    await db.transaction((tx) =>
      patchListing(tx, user(), id, { location: { source: 'godown', pincode: '990025', city: 'Surat', state: 'Gujarat', industrialAreaOther: 'Zzt Lane', lat: 18.5, lng: 73.9 } }),
    );
    await moved(id);
    const [row] = await db.select({ lat: sql<number>`ST_Y(${listings.searchPoint}::geometry)` }).from(listings).where(eq(listings.id, id));
    expect(Number(row!.lat)).toBeCloseTo(18.5, 5);
  });

  it('business location sync', async () => {
    const id = await staleListing({ status: 'live', locationSource: 'business' });
    await db.update(businesses).set({ location: sql`ST_SetSRID(ST_MakePoint(73.0, 19.0), 4326)::geography` }).where(eq(businesses.id, seller.businessId));
    await db.transaction((tx) => syncBusinessListings(tx, seller.businessId));
    await moved(id);
    const [row] = await db.select({ lat: sql<number>`ST_Y(${listings.searchPoint}::geometry)` }).from(listings).where(eq(listings.id, id));
    expect(Number(row!.lat)).toBeCloseTo(19.0, 5);
  });

  it('publish', async () => {
    const id = await staleListing({ status: 'draft', priceModel: 'fixed', pricePaise: 100_000, gstMode: 'extra' });
    await db.transaction((tx) => publishListing(tx, user(), id));
    await moved(id);
  });

  it('relist', async () => {
    const id = await staleListing({ status: 'sold' });
    await db.transaction((tx) => applySellerAction(tx, user(), id, 'relist'));
    await moved(id);
  });

  it('admin edit', async () => {
    const id = await staleListing({ status: 'live' });
    const [row] = await db.select({ version: listings.version }).from(listings).where(eq(listings.id, id));
    await db.transaction((tx) => adminPatchListing(tx, manager.id, id, { version: row!.version, side: 'right' }));
    await moved(id);
  });
});

describe('catalogue changes', () => {
  it('a category rename queues a job without locking any listing; the job rebuilds the descendants', async () => {
    const id = await staleListing({ status: 'live' });
    await refreshListingSearch(db, [id]);

    // Another transaction holds the listing's row lock for the whole rename: the admin transaction must not wait for it.
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM listings WHERE id = $1 FOR UPDATE', [id]);
      const rename = updateCategory(db, manager.id, catalog.categoryId, { name: `Zzt Renamed Root ${runId}` }, app.redis);
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('rename waited for a listing lock')), 5_000));
      await Promise.race([rename, timeout]);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }

    const jobs = await db.select().from(searchRefreshJobs).where(eq(searchRefreshJobs.scopeId, catalog.categoryId));
    expect(jobs.some((j) => j.scopeKind === 'category' && j.doneAt === null && j.createdBy === manager.id)).toBe(true);
    expect((await texts(id)).title).not.toContain('zzt renamed root');

    for (let i = 0; i < 50; i++) {
      const run = await runSearchRefresh(db);
      if (run.jobId === null) break;
    }
    expect((await texts(id)).title).toContain(`zzt renamed root ${runId}`);
    const after = await db.select().from(searchRefreshJobs).where(eq(searchRefreshJobs.scopeId, catalog.categoryId));
    expect(after.every((j) => j.doneAt !== null)).toBe(true);
  });

  it('a failing batch records last_error and the job is retried', async () => {
    for (let i = 0; i < 50; i++) if ((await runSearchRefresh(db)).jobId === null) break;
    const id = await staleListing({ status: 'live' });
    const [job] = await db
      .insert(searchRefreshJobs)
      .values({ scopeKind: 'category', scopeId: catalog.machineTypeId, createdBy: manager.id })
      .returning();

    const failed = await runSearchRefresh(db, { refresh: async () => { throw new Error('zzt boom'); } });
    expect(failed.jobId).toBe(job!.id);
    const [afterFail] = await db.select().from(searchRefreshJobs).where(eq(searchRefreshJobs.id, job!.id));
    expect(afterFail!.lastError).toContain('zzt boom');
    expect(afterFail!.attempts).toBe(1);
    expect(afterFail!.doneAt).toBeNull();

    const ok = await runSearchRefresh(db);
    expect(ok.jobId).toBe(job!.id);
    expect(ok.listings).toBeGreaterThanOrEqual(1);
    const [done] = await db.select().from(searchRefreshJobs).where(eq(searchRefreshJobs.id, job!.id));
    expect(done!.doneAt).not.toBeNull();
    expect(done!.attempts).toBe(2);
    await moved(id);
  });

  it('one tick stops at a failing job: one attempt used, and a newer job with fewer attempts is claimed first', async () => {
    for (let i = 0; i < 50; i++) if ((await runSearchRefresh(db)).jobId === null) break;
    const [bad] = await db
      .insert(searchRefreshJobs)
      .values({ scopeKind: 'category', scopeId: catalog.machineTypeId, createdBy: manager.id })
      .returning();
    const errors: string[] = [];
    const ran = await runSearchRefreshTick(db, {
      refresh: async () => { throw new Error('zzt tick boom'); },
      onError: (r) => errors.push(r.error ?? ''),
    });
    expect(ran).toBe(1);
    expect(errors).toEqual([expect.stringContaining('zzt tick boom')]);
    const [afterTick] = await db.select().from(searchRefreshJobs).where(eq(searchRefreshJobs.id, bad!.id));
    expect(afterTick!.attempts).toBe(1);
    expect(afterTick!.doneAt).toBeNull();

    // A newer job (0 attempts) goes before the older one that failed once.
    const [fresh] = await db
      .insert(searchRefreshJobs)
      .values({ scopeKind: 'category', scopeId: catalog.machineTypeId, createdBy: manager.id })
      .returning();
    expect((await runSearchRefresh(db)).jobId).toBe(fresh!.id);
    expect((await runSearchRefresh(db)).jobId).toBe(bad!.id);
  });

  it('a job that failed 5 times is not claimed again', async () => {
    for (let i = 0; i < 50; i++) if ((await runSearchRefresh(db)).jobId === null) break;
    const [job] = await db
      .insert(searchRefreshJobs)
      .values({ scopeKind: 'category', scopeId: catalog.machineTypeId, createdBy: manager.id, attempts: 5, lastError: 'old' })
      .returning();
    const run = await runSearchRefresh(db);
    expect(run.jobId).not.toBe(job!.id);
  });

  const admin = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${manager.token}` }, ...(payload ? { payload } : {}) });

  /** Runs a mutation and asserts the reader version moved. Returns the response body's data. */
  async function bumps(label: string, call: () => ReturnType<typeof admin>): Promise<{ id: string } & Record<string, unknown>> {
    const before = await readReaderVersion(app.redis);
    const res = await call();
    expect(res.statusCode, `${label}: ${res.body}`).toBeLessThan(300);
    const after = await readReaderVersion(app.redis);
    expect(after, label).toBeGreaterThan(before);
    return (res.json() as { data: { id: string } }).data;
  }

  it('the reader version moves after every catalogue mutation', async () => {
    // Category: create, update, deactivate, activate, delete.
    const cat = await bumps('category create', () => admin('POST', '/admin/categories', { parentId: catalog.machineTypeId, name: `Zzt Group ${runId}` }));
    await bumps('category update', () => admin('PATCH', `/admin/categories/${cat.id}`, { name: `Zzt Group Two ${runId}` }));
    await bumps('category deactivate', () => admin('PATCH', `/admin/categories/${cat.id}`, { isActive: false }));
    await bumps('category activate', () => admin('PATCH', `/admin/categories/${cat.id}`, { isActive: true }));
    await bumps('category delete', () => admin('DELETE', `/admin/categories/${cat.id}`));

    // Brand.
    const b = await bumps('brand create', () => admin('POST', '/admin/brands', { key: `zzt_${runId}`, name: `Zzt Brand ${runId}`, makesMachines: true, makesParts: false }));
    createdBrandIds.push(b.id);
    await bumps('brand update', () => admin('PATCH', `/admin/brands/${b.id}`, { name: `Zzt Brand Two ${runId}` }));
    await bumps('brand deactivate', () => admin('PATCH', `/admin/brands/${b.id}`, { isActive: false }));
    await bumps('brand activate', () => admin('PATCH', `/admin/brands/${b.id}`, { isActive: true }));

    // Model.
    const m = await bumps('model create', () => admin('POST', '/admin/models', { brandId: b.id, machineTypeId: catalog.machineTypeId, key: `zzt_m_${runId}`, name: `Zzt M ${runId}` }));
    await bumps('model update', () => admin('PATCH', `/admin/models/${m.id}`, { name: `Zzt M Two ${runId}` }));
    await bumps('model deactivate', () => admin('PATCH', `/admin/models/${m.id}`, { isActive: false }));
    await bumps('model activate', () => admin('PATCH', `/admin/models/${m.id}`, { isActive: true }));
    await bumps('model delete', () => admin('DELETE', `/admin/models/${m.id}`));
    await bumps('brand delete', () => admin('DELETE', `/admin/brands/${b.id}`));

    // Condition (no delete: conditions are deactivated).
    const c = await bumps('condition create', () => admin('POST', '/admin/master-data/conditions', { key: `zzt_c_${runId}`, label: `Zzt Cond ${runId}` }));
    createdConditionIds.push(c.id);
    await bumps('condition update', () => admin('PATCH', `/admin/master-data/conditions/${c.id}`, { label: `Zzt Cond Two ${runId}` }));
    await bumps('condition deactivate', () => admin('PATCH', `/admin/master-data/conditions/${c.id}`, { isActive: false }));
    await bumps('condition activate', () => admin('PATCH', `/admin/master-data/conditions/${c.id}`, { isActive: true }));

    // Template option (no delete: options are retired).
    const o = await bumps('option create', () => admin('POST', `/admin/fields/${catalog.fieldIds.templeType}/options`, { key: `zzt_o_${runId}`, label: 'Zzt Opt' }));
    await bumps('option update', () => admin('PATCH', `/admin/options/${o.id}`, { label: 'Zzt Opt Two' }));
    await bumps('option deactivate', () => admin('PATCH', `/admin/options/${o.id}`, { status: 'retired' }));
    await bumps('option activate', () => admin('PATCH', `/admin/options/${o.id}`, { status: 'active' }));

    // Renames and label changes queued rebuilds; the other mutations didn't.
    const jobs = await db.select().from(searchRefreshJobs).where(eq(searchRefreshJobs.createdBy, manager.id));
    const kinds = jobs.filter((j) => [cat.id, b.id, m.id, c.id, catalog.fieldIds.templeType].includes(j.scopeId)).map((j) => j.scopeKind).sort();
    // category rename + delete, brand rename + delete, model rename + delete, condition label, option label.
    expect(kinds).toEqual(['brand', 'brand', 'category', 'category', 'condition', 'field', 'model', 'model']);
  });

  it('a new brand becomes a chip and a deactivated brand stops being one after the next dictionary check', async () => {
    const now = { t: 1_000_000 };
    const clock = () => now.t;
    const loader = createReaderDictionaryLoader();
    const name = `Zztchip ${runId}`;
    const q = `zztchip ${runId} spindle`;
    expect(readQuery(q, await loader(db, app.redis, clock)).brand).toBeNull();

    const b = await admin('POST', '/admin/brands', { key: `zzt_chip_${runId}`, name, makesMachines: true, makesParts: false });
    expect(b.statusCode, b.body).toBe(201);
    const brandId = (b.json() as { data: { id: string } }).data.id;
    createdBrandIds.push(brandId);

    now.t += 4_999;
    expect(readQuery(q, await loader(db, app.redis, clock)).brand).toBeNull();
    now.t += 1;
    expect(readQuery(q, await loader(db, app.redis, clock)).brand?.id).toBe(brandId);

    expect((await admin('PATCH', `/admin/brands/${brandId}`, { isActive: false })).statusCode).toBe(200);
    expect(readQuery(q, await loader(db, app.redis, clock)).brand?.id).toBe(brandId);
    now.t += 5_000;
    expect(readQuery(q, await loader(db, app.redis, clock)).brand).toBeNull();
  });
});

describe('backfill', () => {
  it('is idempotent: twice gives the same text', async () => {
    const id = await staleListing({ status: 'live', partNumber: 'BF-1/2' });
    await db.update(listings).set({ searchText: '', searchTitleText: '' }).where(eq(listings.id, id));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await backfillSearch(db, { batchSize: 500 });
    const first = await texts(id);
    expect(first.title).toContain('bf12');
    await backfillSearch(db, { batchSize: 500 });
    expect(await texts(id)).toEqual(first);
  });
});
