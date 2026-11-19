import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { DISCOVERY_LIMITS, type SearchCountRequest } from '@mpm/shared-types';
import { db } from '../src/db/index.js';
import { refreshListingSearch } from '../src/services/discovery/search-text.js';
import { countSql, inSearchTransaction, prepareForExplain } from '../src/services/discovery/search.service.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestRedisKeys } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// F4 + F5 spec §5.4, R1 (plan B1-4): the search's text conditions are written so the indexes serve them, checked with
// EXPLAIN on the count query the service runs: with sequential scans off (the index is usable at all) and with the
// default planner on ~3 000 rows after ANALYZE (the index is chosen for a selective word and a part number).

const SEEDED = 3_000;
let catalog: TestCatalog;
let seller: TestSeller;
let redis: Redis;

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL!);
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: catalog.motorsGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    title: 'Zylophonic spindle पंप',
    partNumber: 'QX-77123',
    point: { lat: 21.2, lng: 72.8 },
  });
  await refreshListingSearch(db, [id]);

  // Clone the listing SEEDED times with varied text and part numbers (every other column as the template's).
  const { rows } = await db.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'listings' AND column_name NOT IN ('id', 'ref')
      AND is_generated = 'NEVER'
    ORDER BY ordinal_position`);
  const overrides: Record<string, string> = {
    title: `'Filler ' || g`,
    title_norm: `'filler ' || g`,
    part_number: `'FL-' || g`,
    part_number_norm: `'FL' || g`,
    part_number_base: `'FL' || g`,
    search_title_text: `'filler ' || md5(g::text)`,
    // About as long as a real listing's text (title, category path, brands, models, spec values).
    search_text: `'filler ' || (SELECT string_agg(md5((g * k)::text), ' ') FROM generate_series(1, 12) k)`,
  };
  const cols = rows.map((r) => r.column_name);
  const list = cols.map((c) => `"${c}"`).join(', ');
  const values = cols.map((c) => overrides[c] ?? `t."${c}"`).join(', ');
  await db.execute(
    sql.raw(`INSERT INTO listings (${list}) SELECT ${values} FROM listings t CROSS JOIN generate_series(1, ${SEEDED}) g WHERE t.id = '${id}'`),
  );
  // VACUUM also flushes the GIN pending list, as autovacuum would on a live table; without it the planner prices the
  // trigram index far too high.
  await db.execute(sql`VACUUM ANALYZE listings`);
}, 60_000);

afterAll(async () => {
  await deleteTestBusinesses([seller.businessId]);
  await deleteTestSellerExtras([seller]);
  await deleteTestCatalog(catalog.categoryId);
  await db.execute(sql`ANALYZE listings`);
  await deleteTestRedisKeys(redis);
  await redis.quit();
}, 60_000);

async function plan(req: SearchCountRequest, opts: { seqscan: boolean }): Promise<string> {
  return inSearchTransaction(db, DISCOVERY_LIMITS.trigramThreshold, async (tx) => {
    if (!opts.seqscan) await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const p = await prepareForExplain(tx, db, req, { redis });
    const { rows } = await tx.execute<{ 'QUERY PLAN': string }>(sql`EXPLAIN ${countSql(p, 'full')}`);
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  });
}

describe('EXPLAIN: the indexes serve the text conditions', () => {
  it('seeded rows are there', async () => {
    const { rows } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM listings WHERE business_id = ${seller.businessId}`);
    expect(Number(rows[0]!.n)).toBe(SEEDED + 1);
  });

  it('with sequential scans off: three words, a Hindi word, a part number', async () => {
    expect(await plan({ q: 'zylophonic spindle filler' }, { seqscan: false })).toContain('listings_search_text_trgm_idx');
    expect(await plan({ q: 'पंप' }, { seqscan: false })).toContain('listings_search_text_trgm_idx');
    const pn = await plan({ q: 'QX-77123' }, { seqscan: false });
    expect(pn).toContain('listings_part_number_norm_idx');
  });

  it('with the default planner: a selective word and a part number use their index', async () => {
    const word = await plan({ q: 'zylophonic' }, { seqscan: true });
    expect(word, word).toContain('listings_search_text_trgm_idx');
    const pn = await plan({ q: 'QX77123' }, { seqscan: true });
    expect(pn, pn).toContain('listings_part_number_norm_idx');
  });
});
