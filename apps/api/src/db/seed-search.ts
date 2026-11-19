import '../env.js';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { db, pool, type Db, type Tx } from './index.js';
import { appSettings, searchSynonyms } from './schema.js';
import { SEARCH_SEED_STOP_WORDS, searchSeedRows } from './seed-data/search-synonyms.js';
import { STOP_WORDS_SETTING } from '../services/discovery/reader-dictionary.js';
import { bumpReaderVersion } from '../services/discovery/reader-version.js';

/**
 * Loads the search seed (F4 + F5 spec §5.3, §7.1): side words, machine-parts synonyms and the stop words. Insert-only,
 * like the other seeds: refuses when `search_synonyms` has any row or the stop words are already set, since the category
 * manager edits them in the admin panel after the seed.
 */
export async function loadSearchSeed(tx: Tx): Promise<{ synonyms: number; stopWords: number }> {
  const [existing] = await tx.select({ id: searchSynonyms.id }).from(searchSynonyms).limit(1);
  const [stop] = await tx.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, STOP_WORDS_SETTING));
  if (existing || stop) {
    throw new Error('Search synonyms already loaded: the seed only fills an empty table. Edit them in the admin panel.');
  }
  const rows = searchSeedRows();
  await tx.insert(searchSynonyms).values(rows);
  await tx.insert(appSettings).values({ key: STOP_WORDS_SETTING, value: [...SEARCH_SEED_STOP_WORDS] });
  return { synonyms: rows.length, stopWords: SEARCH_SEED_STOP_WORDS.length };
}

/**
 * Loads the seed in one transaction (a savepoint when `conn` is already a transaction), then bumps the reader version
 * key so a running API reads the words within 5 s.
 */
export async function runSearchSeed(conn: Db | Tx, redis: Redis | null): Promise<{ synonyms: number; stopWords: number }> {
  const loaded = await conn.transaction((tx) => loadSearchSeed(tx));
  await bumpReaderVersion(redis);
  return loaded;
}

/**
 *   pnpm --filter @mpm/api db:seed:search
 */
async function main() {
  const url = process.env.REDIS_URL;
  const redis = url ? new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
  try {
    await redis?.connect();
  } catch {
    console.warn('Redis unreachable: a running API reads the new words after its next restart or catalogue change.');
  }
  try {
    const loaded = await runSearchSeed(db, redis?.status === 'ready' ? redis : null);
    console.log(`search synonyms: ${loaded.synonyms}, stop words: ${loaded.stopWords}`);
  } finally {
    redis?.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
