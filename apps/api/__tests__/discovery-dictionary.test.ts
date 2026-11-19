import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { db } from '../src/db/index.js';
import { appSettings, searchSynonyms } from '../src/db/schema.js';
import { createReaderDictionaryLoader, STOP_WORDS_SETTING } from '../src/services/discovery/reader-dictionary.js';
import { readQuery } from '../src/services/discovery/query-reader.js';
import { bumpReaderVersion } from '../src/services/discovery/reader-version.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestDiscovery, deleteTestRedisKeys, testRunId, testTerm } from './_helpers/test-discovery.js';

// F4 + F5 spec §5.3, §12 (plan B1-3): each API instance's dictionary sees a synonym or catalogue change after its next
// version check (at most every 5 s), driven by a fake clock, never a real wait.

const runId = testRunId();
let redis: Redis;
let admin: { id: string; token: string };
let hadStopWords = false;

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL!);
  admin = await createTestAdmin('category_manager');
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, STOP_WORDS_SETTING));
  hadStopWords = !!row;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await deleteTestDiscovery(runId, { adminIds: [admin.id] });
  if (!hadStopWords) await db.delete(appSettings).where(eq(appSettings.key, STOP_WORDS_SETTING));
  await deleteTestAdmins([admin.id]);
  await deleteTestRedisKeys(redis);
  await redis.quit();
});

describe('loadReaderDictionary', () => {
  it('a second instance sees a new synonym after its next 5 s check, not before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
    const instanceA = createReaderDictionaryLoader();
    const instanceB = createReaderDictionaryLoader();
    const term = testTerm(runId, 'tre');
    const q = `${term} lh`;
    expect(readQuery(q, await instanceA(db, redis)).words).not.toContain('steering');
    expect(readQuery(q, await instanceB(db, redis)).words).not.toContain('steering');

    // The synonym admin's write: insert, then bump after commit.
    await db.insert(searchSynonyms).values({
      term, termNorm: term.replace(/-/g, ' '), script: 'latin', targetKind: 'word', targetWord: 'steering knuckle', createdBy: admin.id,
    });
    await bumpReaderVersion(redis);

    vi.advanceTimersByTime(4_999);
    expect(readQuery(q, await instanceB(db, redis)).words).not.toContain('steering');
    vi.advanceTimersByTime(1);
    expect(readQuery(q, await instanceB(db, redis)).words).toEqual(['steering', 'knuckle', 'lh']);
    // Instance A checks on its own schedule: same moment, same answer.
    expect(readQuery(q, await instanceA(db, redis)).words).toEqual(['steering', 'knuckle', 'lh']);
  });

  it('without a version bump the cached dictionary is kept after the 5 s check', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T11:00:00Z'));
    const loader = createReaderDictionaryLoader();
    const term = testTerm(runId, 'quiet');
    await loader(db, redis);
    await db.insert(searchSynonyms).values({
      term, termNorm: term.replace(/-/g, ' '), script: 'latin', targetKind: 'word', targetWord: 'silent', createdBy: admin.id,
    });
    vi.advanceTimersByTime(10_000);
    expect(readQuery(term, await loader(db, redis)).words).not.toContain('silent');
    await bumpReaderVersion(redis);
    vi.advanceTimersByTime(5_000);
    expect(readQuery(term, await loader(db, redis)).words).toEqual(['silent']);
  });

  it('inactive synonyms are not read', async () => {
    const loader = createReaderDictionaryLoader();
    const term = testTerm(runId, 'off');
    await db.insert(searchSynonyms).values({
      term, termNorm: term.replace(/-/g, ' '), script: 'latin', targetKind: 'word', targetWord: 'nowhere', isActive: false, createdBy: admin.id,
    });
    expect(readQuery(term, await loader(db, redis)).words).not.toContain('nowhere');
  });

  it('stop words come from app_settings when set, else the defaults', async () => {
    const before = createReaderDictionaryLoader();
    expect(readQuery('pump for seal', await before(db, redis)).words).toEqual(['pump', 'seal']);
    if (!hadStopWords) {
      await db.insert(appSettings).values({ key: STOP_WORDS_SETTING, value: ['seal'] });
      const after = createReaderDictionaryLoader();
      expect(readQuery('pump for seal', await after(db, redis)).words).toEqual(['pump', 'for']);
    }
  });
});
