import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { assertApiEnv, discoveryCursorSecret } from '../src/env.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { deleteTestDiscovery, testRunId, testTerm } from './_helpers/test-discovery.js';
import { uniqueTestPhone } from './_helpers/test-users.js';

// F4 + F5 data model (spec 2026-11-19-f4-f5-discovery-design §4, §4.8, §12; plan B0-2). Raw SQL on purpose: these tests
// check what the database itself has and refuses, whatever the service layer does.

const runId = testRunId();
let catalog: TestCatalog;
let seller: TestSeller;
let buyer: TestSeller;

async function rowsOf<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

beforeAll(async () => {
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  buyer = await createTestSeller({ machineCategoryId: catalog.categoryId });
});

afterAll(async () => {
  await deleteTestDiscovery(runId, { userIds: [seller.userId, buyer.userId] });
  await deleteTestBusinesses([seller.businessId, buyer.businessId]);
  await deleteTestSellerExtras([seller, buyer]);
  await deleteTestCatalog(catalog.categoryId);
});

describe('discovery schema', () => {
  it('adds the search columns to listings and the context flag to brands', async () => {
    const cols = await rowsOf<{ table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null }>(sql`
      SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns
      WHERE (table_name = 'listings' AND column_name IN ('search_title_text', 'search_text', 'search_point', 'search_refreshed_at'))
         OR (table_name = 'brands' AND column_name = 'chip_needs_context')
      ORDER BY table_name, column_name`);
    const by = Object.fromEntries(cols.map((c) => [`${c.table_name}.${c.column_name}`, c]));
    expect(Object.keys(by).sort()).toEqual([
      'brands.chip_needs_context', 'listings.search_point', 'listings.search_refreshed_at', 'listings.search_text', 'listings.search_title_text',
    ]);
    expect(by['listings.search_text']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(by['listings.search_text']!.column_default).toContain("''");
    expect(by['listings.search_title_text']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(by['listings.search_point']!.udt_name).toBe('geography');
    expect(by['listings.search_refreshed_at']!.data_type).toBe('timestamp with time zone');
    expect(by['brands.chip_needs_context']).toMatchObject({ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' });
  });

  it('creates the discovery tables', async () => {
    const tables = await rowsOf<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('search_synonyms', 'search_queries', 'search_trending_hidden', 'saved_listings', 'search_refresh_jobs')
      ORDER BY table_name`);
    expect(tables.map((t) => t.table_name)).toEqual(['saved_listings', 'search_queries', 'search_refresh_jobs', 'search_synonyms', 'search_trending_hidden']);
  });

  it('creates the enums', async () => {
    const enums = await rowsOf<{ typname: string; labels: string[] }>(sql`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('search_script', 'synonym_target', 'search_refresh_scope')
      GROUP BY t.typname ORDER BY t.typname`);
    expect(enums).toEqual([
      { typname: 'search_refresh_scope', labels: ['category', 'brand', 'model', 'field', 'condition'] },
      { typname: 'search_script', labels: ['latin', 'devanagari', 'gujarati'] },
      { typname: 'synonym_target', labels: ['category', 'brand', 'model', 'side', 'word'] },
    ]);
  });

  it('creates the indexes', async () => {
    const idx = await rowsOf<{ indexname: string; indexdef: string }>(sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN ('listings_search_text_trgm_idx', 'listings_search_title_text_trgm_idx', 'listings_search_point_idx',
        'listings_public_refreshed_idx', 'search_synonyms_term_target_uq', 'search_queries_day_normalized_idx',
        'saved_listings_user_created_idx', 'search_refresh_jobs_pending_idx')`);
    const by = Object.fromEntries(idx.map((i) => [i.indexname, i.indexdef]));
    expect(Object.keys(by)).toHaveLength(8);
    expect(by.listings_search_text_trgm_idx).toMatch(/USING gin \(search_text gin_trgm_ops\)/);
    expect(by.listings_search_title_text_trgm_idx).toMatch(/USING gin \(search_title_text gin_trgm_ops\)/);
    expect(by.listings_search_point_idx).toMatch(/USING gist \(search_point\)/);
    expect(by.listings_public_refreshed_idx).toMatch(/\(kind, refreshed_at DESC NULLS LAST\)/);
    expect(by.listings_public_refreshed_idx).toMatch(/WHERE \(status = ANY/);
    expect(by.search_synonyms_term_target_uq).toMatch(/UNIQUE/);
    expect(by.saved_listings_user_created_idx).toMatch(/\(user_id, created_at DESC NULLS LAST, listing_id\)/);
  });

  it('refuses a synonym with two targets, or none', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO search_synonyms (term, term_norm, script, target_kind, target_side, target_word)
        VALUES (${testTerm(runId, 'two')}, ${testTerm(runId, 'two')}, 'latin', 'side', 'left', 'left')`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'search_synonyms_target_shape' });
    await expect(
      db.execute(sql`
        INSERT INTO search_synonyms (term, term_norm, script, target_kind)
        VALUES (${testTerm(runId, 'none')}, ${testTerm(runId, 'none')}, 'latin', 'word')`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'search_synonyms_target_shape' });
    await expect(
      db.execute(sql`
        INSERT INTO search_synonyms (term, term_norm, script, target_kind, target_side)
        VALUES (${testTerm(runId, 'na')}, ${testTerm(runId, 'na')}, 'latin', 'side', 'not_applicable')`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'search_synonyms_target_shape' });
  });

  it('refuses a duplicate synonym but lets one term point at two targets', async () => {
    const term = testTerm(runId, 'dup');
    await db.execute(sql`
      INSERT INTO search_synonyms (term, term_norm, script, target_kind, target_word) VALUES (${term}, ${term}, 'latin', 'word', 'tie rod end')`);
    await expect(
      db.execute(sql`
        INSERT INTO search_synonyms (term, term_norm, script, target_kind, target_word) VALUES (${term}, ${term}, 'latin', 'word', 'tie rod end')`),
    ).rejects.toMatchObject({ code: '23505', constraint: 'search_synonyms_term_target_uq' });
    await db.execute(sql`
      INSERT INTO search_synonyms (term, term_norm, script, target_kind, target_side) VALUES (${term}, ${term}, 'latin', 'side', 'left')`);
    await expect(
      db.execute(sql`
        INSERT INTO search_synonyms (term, term_norm, script, target_kind, target_side) VALUES (${term}, ${term}, 'latin', 'side', 'left')`),
    ).rejects.toMatchObject({ code: '23505', constraint: 'search_synonyms_term_target_uq' });
  });

  it('deletes saved rows with their listing (and their user)', async () => {
    const { id } = await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId });
    await db.execute(sql`INSERT INTO saved_listings (user_id, listing_id) VALUES (${buyer.userId}, ${id})`);
    await expect(db.execute(sql`INSERT INTO saved_listings (user_id, listing_id) VALUES (${buyer.userId}, ${id})`)).rejects.toMatchObject({
      code: '23505',
    });
    await db.execute(sql`DELETE FROM listing_media WHERE listing_id = ${id}`);
    await db.execute(sql`DELETE FROM part_request_work WHERE subject_id = ${id}`);
    await db.execute(sql`DELETE FROM listings WHERE id = ${id}`);
    const [left] = await rowsOf<{ n: number }>(sql`SELECT count(*)::int AS n FROM saved_listings WHERE listing_id = ${id}`);
    expect(left!.n).toBe(0);

    // A throwaway user (no business) saves a listing, then is deleted: the saved row goes with them.
    const kept = await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId });
    const [throwaway] = await rowsOf<{ id: string }>(sql`INSERT INTO users (phone) VALUES (${uniqueTestPhone()}) RETURNING id`);
    await db.execute(sql`INSERT INTO saved_listings (user_id, listing_id) VALUES (${throwaway!.id}, ${kept.id})`);
    await db.execute(sql`DELETE FROM users WHERE id = ${throwaway!.id}`);
    const [gone] = await rowsOf<{ n: number }>(sql`SELECT count(*)::int AS n FROM saved_listings WHERE user_id = ${throwaway!.id}`);
    expect(gone!.n).toBe(0);
    const [listingKept] = await rowsOf<{ n: number }>(sql`SELECT count(*)::int AS n FROM listings WHERE id = ${kept.id}`);
    expect(listingKept!.n).toBe(1);
  });

  it('runs on a UTF-8 database with pg_trgm, on Postgres 13 or newer', async () => {
    const [d] = await rowsOf<{ ctype: string; encoding: string }>(sql`
      SELECT datctype AS ctype, pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = current_database()`);
    expect(d!.encoding).toBe('UTF8');
    expect(d!.ctype).toMatch(/utf-?8/i);
    const [ext] = await rowsOf<{ n: number }>(sql`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'pg_trgm'`);
    expect(ext!.n).toBe(1);
    const [v] = await rowsOf<{ v: number }>(sql`SELECT current_setting('server_version_num')::int AS v`);
    expect(v!.v).toBeGreaterThanOrEqual(130000);
  });

  it('has an IMMUTABLE mpm_normalize_search that keeps Hindi and Gujarati trigrams', async () => {
    const [fn] = await rowsOf<{ provolatile: string }>(sql`SELECT provolatile FROM pg_proc WHERE proname = 'mpm_normalize_search'`);
    expect(fn!.provolatile).toBe('i');
    const [r] = await rowsOf<{ hi: string[]; gu: string[]; latin: string; joiners: string; digits: string }>(sql`
      SELECT show_trgm(mpm_normalize_search('बायाँ')) AS hi, show_trgm(mpm_normalize_search('ડાબું')) AS gu,
             mpm_normalize_search('  Crème-Brûlée / AB-123  ') AS latin,
             mpm_normalize_search(${'ब‍ाय‌ाँ soft­hyphen'}) AS joiners,
             mpm_normalize_search('१२३ ૪૫૬ 789 । ॥') AS digits`);
    expect(r!.hi.length).toBeGreaterThan(0);
    expect(r!.gu.length).toBeGreaterThan(0);
    expect(r!.latin).toBe('creme brulee ab 123');
    expect(r!.joiners).toBe('बायाँ softhyphen');
    expect(r!.digits).toBe('123 456 789');
  });
});

describe('discovery env', () => {
  it('refuses a missing or short cursor secret', () => {
    expect(() => assertApiEnv({})).toThrow(/DISCOVERY_CURSOR_SECRET/);
    expect(() => assertApiEnv({ DISCOVERY_CURSOR_SECRET: 'short' })).toThrow(/DISCOVERY_CURSOR_SECRET/);
    expect(() => assertApiEnv({ DISCOVERY_CURSOR_SECRET: 'x'.repeat(32) })).not.toThrow();
    expect(discoveryCursorSecret({ DISCOVERY_CURSOR_SECRET: 'y'.repeat(40) })).toBe('y'.repeat(40));
  });

  it('is set in the test env', () => {
    expect(discoveryCursorSecret().length).toBeGreaterThanOrEqual(32);
    expect(process.env.DISCOVERY_REDIS_PREFIX).toMatch(/^test:[a-z0-9]+:$/);
  });
});
