import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { db } from '../src/db/index.js';
import { appSettings, listings, searchSynonyms } from '../src/db/schema.js';
import { loadSearchSeed, runSearchSeed } from '../src/db/seed-search.js';
import { fullMatchSql } from '../src/services/discovery/matching.js';
import { refreshListingSearch } from '../src/services/discovery/search-text.js';
import { readReaderVersion } from '../src/services/discovery/reader-version.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestRedisKeys } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { SEARCH_SEED_STOP_WORDS, SIDE_WORDS, WORD_SYNONYMS, searchSeedRows } from '../src/db/seed-data/search-synonyms.js';
import { normalizeSearchText } from '../src/services/discovery/normalize.js';
import { readQuery } from '../src/services/discovery/query-reader.js';
import { fetchReaderDictionary, STOP_WORDS_SETTING } from '../src/services/discovery/reader-dictionary.js';

// F4 + F5 spec §5.3, §7.1 (plan B2-3): the search seed — side words, machine-parts synonyms, stop words.

class Rollback extends Error {}

let redis: Redis;
let catalog: TestCatalog;
let seller: TestSeller;

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
});

afterAll(async () => {
  await deleteTestBusinesses([seller.businessId]);
  await deleteTestSellerExtras([seller]);
  await deleteTestCatalog(catalog.categoryId);
  await deleteTestRedisKeys(redis);
  await redis.quit();
});

describe('search seed data', () => {
  it('has the side words of §5.3, no single letters and no "set"', () => {
    expect(SIDE_WORDS.left).toEqual(expect.arrayContaining(['left', 'lh', 'l h', 'left hand', 'left side', 'लेफ्ट', 'बायाँ', 'ડાબું', 'લેફ્ટ']));
    expect(SIDE_WORDS.right).toEqual(expect.arrayContaining(['right', 'rh', 'r h', 'right hand', 'right side', 'राइट', 'दायाँ', 'જમણું', 'રાઇટ']));
    expect(SIDE_WORDS.pair).toEqual(expect.arrayContaining(['pair', 'जोड़ी', 'जोड़ा', 'જોડી']));
    for (const words of Object.values(SIDE_WORDS)) {
      for (const w of words) {
        expect(normalizeSearchText(w).length, w).toBeGreaterThan(1);
        expect(normalizeSearchText(w)).not.toBe('set');
      }
    }
  });

  it('has about 60 word synonyms, each normalising to something other than its target', () => {
    expect(WORD_SYNONYMS.length).toBeGreaterThanOrEqual(55);
    expect(WORD_SYNONYMS.length).toBeLessThanOrEqual(80);
    for (const [term, words] of WORD_SYNONYMS) {
      expect(normalizeSearchText(term), term).not.toBe('');
      expect(normalizeSearchText(words), term).not.toBe('');
      expect(normalizeSearchText(term), term).not.toBe(normalizeSearchText(words));
    }
    const terms = Object.fromEntries(WORD_SYNONYMS.map(([t, w]) => [normalizeSearchText(t), normalizeSearchText(w)]));
    expect(terms).toMatchObject({ tre: 'tie rod end', fender: 'mudguard', bush: 'bushing', brg: 'bearing', cyl: 'cylinder', hyd: 'hydraulic', assy: 'assembly' });
    expect(terms[normalizeSearchText('गियर')]).toBe('gear');
    expect(terms[normalizeSearchText('બેરિંગ')]).toBe('bearing');
  });

  it('gives rows with a unique key, the right script and normalised targets', () => {
    const rows = searchSeedRows();
    const keys = rows.map((r) => `${r.termNorm}|${r.targetKind}|${r.targetSide ?? ''}|${r.targetWord ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of rows) {
      expect(r.termNorm).toBe(normalizeSearchText(r.term));
      if (r.targetKind === 'word') expect(r.targetWord).toBe(normalizeSearchText(r.targetWord));
      if (/[ऀ-ॿ]/.test(r.term)) expect(r.script).toBe('devanagari');
      else if (/[઀-૿]/.test(r.term)) expect(r.script).toBe('gujarati');
      else expect(r.script).toBe('latin');
    }
    expect(SEARCH_SEED_STOP_WORDS).toEqual(expect.arrayContaining(['for', 'of', 'the', 'ka', 'का', 'નું']));
  });
});

describe('loadSearchSeed', () => {
  it('loads once, then refuses a second run; the reader reads the seeded words (rolled back)', async () => {
    const [existing] = await db.select({ id: searchSynonyms.id }).from(searchSynonyms).limit(1);
    expect(existing, 'mpm_test must have no synonyms before this suite').toBeUndefined();

    await expect(
      db.transaction(async (tx) => {
        const loaded = await loadSearchSeed(tx);
        expect(loaded.synonyms).toBe(searchSeedRows().length);
        expect(loaded.stopWords).toBe(SEARCH_SEED_STOP_WORDS.length);
        const [stop] = await tx.select().from(appSettings).where(eq(appSettings.key, STOP_WORDS_SETTING));
        expect(stop!.value).toEqual([...SEARCH_SEED_STOP_WORDS]);

        const dict = await fetchReaderDictionary(tx);
        const reading = readQuery('TRE for tata LH', dict);
        expect(reading.side).toBe('left');
        expect(reading.words).toEqual(['tata']);
        expect(reading.wordGroups).toEqual([{ typed: ['tre'], alternatives: [['tie', 'rod', 'end']] }]);
        expect(readQuery('दायाँ गियर', dict)).toMatchObject({ side: 'right', words: [], wordGroups: [{ typed: ['गियर'], alternatives: [['gear']] }] });
        expect(readQuery('જોડી બેરિંગ', dict)).toMatchObject({ side: 'pair', words: [], wordGroups: [{ typed: ['બેરિંગ'], alternatives: [['bearing']] }] });

        // "bush" (en / hi / gu) finds "Rubber bush" and "Bushing kit"; "mudguard" finds "Front fender".
        const made: Record<string, string> = {};
        for (const title of ['Rubber bush', 'Bushing kit', 'Front fender', 'Spur gear']) {
          made[title] = (await insertTestListing(tx, {
            businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId, title,
          })).id;
        }
        await refreshListingSearch(tx, Object.values(made));
        const hits = async (q: string) => {
          const r = readQuery(q, dict);
          const match = fullMatchSql({ words: r.words, groups: r.wordGroups.map((g) => [g.typed, ...g.alternatives]), partNumbers: r.partNumbers, side: r.side });
          const rows = await tx.select({ title: listings.title }).from(listings).where(and(inArray(listings.id, Object.values(made)), match!));
          return rows.map((x) => x.title).sort();
        };
        for (const q of ['bush', 'बुश', 'બુશ']) expect(await hits(q), q).toEqual(['Bushing kit', 'Rubber bush']);
        expect(await hits('mudguard')).toEqual(['Front fender']);

        await expect(tx.transaction((inner) => loadSearchSeed(inner))).rejects.toThrow(/already/i);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    expect(await db.select({ id: searchSynonyms.id }).from(searchSynonyms).limit(1)).toEqual([]);
    expect(await db.select().from(appSettings).where(eq(appSettings.key, STOP_WORDS_SETTING))).toEqual([]);
  });

  it('refuses when only the stop words are set (rolled back)', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(appSettings).values({ key: STOP_WORDS_SETTING, value: ['for'] });
        await expect(tx.transaction((inner) => loadSearchSeed(inner))).rejects.toThrow(/already/i);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(await db.select().from(appSettings).where(eq(appSettings.key, STOP_WORDS_SETTING))).toEqual([]);
  });

  it('the command bumps the reader version after loading (rolled back)', async () => {
    const before = await readReaderVersion(redis);
    await expect(
      db.transaction(async (tx) => {
        const loaded = await runSearchSeed(tx, redis);
        expect(loaded.synonyms).toBe(searchSeedRows().length);
        expect(await readReaderVersion(redis)).toBe(before + 1);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(await db.select({ id: searchSynonyms.id }).from(searchSynonyms).limit(1)).toEqual([]);
  });
});
