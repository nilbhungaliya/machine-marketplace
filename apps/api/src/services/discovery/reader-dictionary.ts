import { and, eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DISCOVERY_LIMITS, type SearchSide } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { appSettings, brands, categories, listings, machineModels, searchSynonyms, units } from '../../db/schema.js';
import { buildReaderDictionary, DEFAULT_STOP_WORDS, type ReaderCategory, type ReaderDictionary } from './query-reader.js';
import { readReaderVersion } from './reader-version.js';
import { discoveryWhere } from './visibility.js';

// The query reader's dictionary (F4 + F5 spec §5.3): active synonyms and the active category, brand and model names,
// plus the stop words. Cached in-process and checked against the Redis version key (`reader-version.ts`) at most every
// 5 s, so every API instance sees a synonym or catalogue change within 5 s. Without Redis it reloads every 5 s.

type Conn = Db | Tx;

/** `app_settings` key of the admin's stop-word list (a JSON array of strings; seeded in B2). */
export const STOP_WORDS_SETTING = 'search.stop_words';

/** Reads the dictionary's rows from the database. */
export async function fetchReaderDictionary(conn: Conn): Promise<ReaderDictionary> {
  const synonymRows = await conn
    .select({
      term: searchSynonyms.term,
      kind: searchSynonyms.targetKind,
      targetId: searchSynonyms.targetId,
      side: searchSynonyms.targetSide,
      words: searchSynonyms.targetWord,
    })
    .from(searchSynonyms)
    .where(eq(searchSynonyms.isActive, true));
  const categoryRows = await conn
    .select({ id: categories.id, name: categories.name, level: categories.level, path: categories.path })
    .from(categories)
    .where(eq(categories.isActive, true));
  const brandRows = await conn
    .select({ id: brands.id, name: brands.name, chipNeedsContext: brands.chipNeedsContext })
    .from(brands)
    .where(eq(brands.isActive, true));
  const modelRows = await conn
    .select({ id: machineModels.id, name: machineModels.name, brandId: machineModels.brandId })
    .from(machineModels)
    .innerJoin(brands, eq(brands.id, machineModels.brandId))
    .where(and(eq(machineModels.isActive, true), eq(brands.isActive, true)));

  const unitRows = await conn.select({ key: units.key, label: units.label }).from(units);

  // Public listings per category path, summed up the tree (the category tie-break).
  const { rows: counts } = await conn.execute<{ path: string; n: number }>(sql`
    SELECT c.path, count(*)::int AS n
    FROM listings JOIN categories c ON c.id = ${listings.categoryId}
    WHERE ${discoveryWhere(listings)}
    GROUP BY c.path`);
  const byPath = new Map<string, number>();
  for (const { path, n } of counts) {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      byPath.set(prefix, (byPath.get(prefix) ?? 0) + Number(n));
    }
  }
  const cats: ReaderCategory[] = categoryRows.map((c) => ({ id: c.id, name: c.name, level: c.level, liveCount: byPath.get(c.path) ?? 0 }));

  const [stop] = await conn.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, STOP_WORDS_SETTING));
  const stopWords =
    Array.isArray(stop?.value) && stop.value.every((w) => typeof w === 'string') ? (stop.value as string[]) : DEFAULT_STOP_WORDS;

  return buildReaderDictionary({
    synonyms: synonymRows.map((s) => ({
      term: s.term,
      kind: s.kind,
      targetId: s.targetId,
      side: s.side === 'left' || s.side === 'right' || s.side === 'pair' ? (s.side as SearchSide) : null,
      words: s.words,
    })),
    categories: cats,
    brands: brandRows,
    models: modelRows,
    stopWords,
    units: unitRows.flatMap((u) => [u.key, u.label]),
  });
}

export type DictionaryLoader = (conn: Conn, redis: Redis | null | undefined, now?: () => number) => Promise<ReaderDictionary>;

/**
 * A loader with its own in-process cache (one per API process; tests make a second one to act as another instance).
 * Within 5 s of the last check the cached dictionary is returned as is; after that the Redis version is read and the
 * dictionary reloaded only when the version moved (always, without Redis).
 */
export function createReaderDictionaryLoader(): DictionaryLoader {
  let cache: { dict: ReaderDictionary; version: number | null; checkedAt: number } | null = null;
  return async (conn, redis, now = Date.now) => {
    const t = now();
    if (cache && t - cache.checkedAt < DISCOVERY_LIMITS.readerVersionCheckMs) return cache.dict;
    const version = redis ? await readReaderVersion(redis) : null;
    if (cache && version !== null && version === cache.version) {
      cache.checkedAt = t;
      return cache.dict;
    }
    const dict = await fetchReaderDictionary(conn);
    cache = { dict, version, checkedAt: t };
    return dict;
  };
}

/** The process's loader. */
export const loadReaderDictionary: DictionaryLoader = createReaderDictionaryLoader();
