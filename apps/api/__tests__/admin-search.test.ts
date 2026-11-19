import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Brand, QueryReading, SearchSynonym, TrendingRow, ZeroResultRow } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, brands, searchQueries } from '../src/db/schema.js';
import { readQuery } from '../src/services/discovery/query-reader.js';
import { createReaderDictionaryLoader } from '../src/services/discovery/reader-dictionary.js';
import { readReaderVersion } from '../src/services/discovery/reader-version.js';
import { listSynonyms } from '../src/services/discovery/synonym-admin.service.js';
import { adminTrending, zeroResults } from '../src/services/discovery/insights.service.js';
import { indiaDay, trending } from '../src/services/discovery/trending.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBrand, createTestCatalog, deleteTestBrands, deleteTestCatalog, type TestBrand, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestDiscovery, deleteTestRedisKeys, testRunId, testTerm, testTermNorm } from './_helpers/test-discovery.js';

// F4 + F5 spec §7.1, §9 (plan B2-3): synonym CRUD, preview, zero results, trending hide / unhide, the brand flag.

const runId = testRunId();
const norm = testTermNorm(runId);
let app: FastifyInstance;
let catalog: TestCatalog;
let brand: TestBrand;
let inactiveBrand: TestBrand;
let bullId = '';
const bullName = `Zztbull${runId}`;
let manager: { id: string; token: string };
let superAdmin: { id: string; token: string };
let moderator: { id: string; token: string };

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  brand = await createTestBrand({ makesParts: true });
  inactiveBrand = await createTestBrand();
  await db.update(brands).set({ isActive: false }).where(eq(brands.id, inactiveBrand.id));
  const [bull] = await db
    .insert(brands)
    .values({ key: `zztbull_${runId}`, name: bullName, slug: `zztbull-${runId}`, makesMachines: true, makesParts: true, sortOrder: 9999 })
    .returning({ id: brands.id });
  bullId = bull!.id;
  manager = await createTestAdmin('category_manager');
  superAdmin = await createTestAdmin('super_admin');
  moderator = await createTestAdmin('moderator');
});

afterAll(async () => {
  const admins = [manager.id, superAdmin.id, moderator.id];
  await deleteTestDiscovery(runId, { adminIds: admins });
  await deleteTestAdmins(admins);
  await deleteTestBrands([brand.id, inactiveBrand.id, bullId]);
  await deleteTestCatalog(catalog.categoryId);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  await app?.close();
});

type Who = { token: string };
const call = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { authorization: `Bearer ${who.token}` } });

async function lastAudit(action: string, entityId?: string) {
  const [row] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), entityId ? eq(auditLog.entityId, entityId) : undefined))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  return row;
}

describe('RBAC', () => {
  it('lets the category manager and super admin in, not a moderator', async () => {
    expect((await call(moderator, 'GET', '/admin/search/synonyms')).statusCode).toBe(403);
    expect((await call(moderator, 'POST', '/admin/search/synonyms', { term: 'x', targetKind: 'word', targetWord: 'y' })).statusCode).toBe(403);
    expect((await call(moderator, 'GET', '/admin/search/zero-results')).statusCode).toBe(403);
    expect((await call(manager, 'GET', '/admin/search/synonyms')).statusCode).toBe(200);
    expect((await call(superAdmin, 'GET', '/admin/search/synonyms')).statusCode).toBe(200);
    expect((await call(superAdmin, 'GET', '/admin/search/trending')).statusCode).toBe(200);
  });
});

describe('synonyms', () => {
  let wordId = '';

  it('creates a word synonym: normalised, script derived, audited, reader version bumped', async () => {
    const v0 = await readReaderVersion(app.redis);
    const res = await call(manager, 'POST', '/admin/search/synonyms', { term: testTerm(runId, 'TRE'), targetKind: 'word', targetWord: 'Tie-Rod  End' });
    expect(res.statusCode).toBe(201);
    const s = res.json().data as SearchSynonym;
    expect(s).toMatchObject({
      term: testTerm(runId, 'TRE'), termNorm: `${norm} tre`, script: 'latin', targetKind: 'word', targetWord: 'tie rod end',
      targetId: null, targetSide: null, targetName: null, isActive: true,
    });
    wordId = s.id;
    expect(await readReaderVersion(app.redis)).toBeGreaterThan(v0);
    const audit = await lastAudit('search_synonym.create', s.id);
    expect(audit).toMatchObject({ adminId: manager.id, entityType: 'search_synonym', before: null });
    expect(audit!.after).toMatchObject({ id: s.id, targetWord: 'tie rod end' });
  });

  it('refuses a duplicate with 409 SYNONYM_EXISTS', async () => {
    const res = await call(manager, 'POST', '/admin/search/synonyms', { term: testTerm(runId, 'tre'), targetKind: 'word', targetWord: 'tie rod end' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SYNONYM_EXISTS');
  });

  it('refuses a bad target with 400 SYNONYM_TARGET_INVALID', async () => {
    const bad = [
      { term: testTerm(runId, 'b1'), targetKind: 'brand', targetId: randomUUID() },
      { term: testTerm(runId, 'b2'), targetKind: 'brand', targetId: inactiveBrand.id },
      { term: testTerm(runId, 'b3'), targetKind: 'brand' },
      { term: testTerm(runId, 'b4'), targetKind: 'word', targetWord: 'x', targetId: brand.id },
      { term: testTerm(runId, 'b5'), targetKind: 'category', targetId: brand.id },
      { term: testTerm(runId, 'b6'), targetKind: 'model', targetId: brand.id },
      { term: testTerm(runId, 'b7'), targetKind: 'word', targetWord: ' - ' },
      { term: testTerm(runId, 'b8'), targetKind: 'side', targetSide: 'not_applicable' },
    ];
    for (const body of bad) {
      const res = await call(manager, 'POST', '/admin/search/synonyms', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().code, JSON.stringify(body)).toBe('SYNONYM_TARGET_INVALID');
    }
    expect((await call(manager, 'POST', '/admin/search/synonyms', { term: '  ', targetKind: 'word', targetWord: 'x' })).statusCode).toBe(400);
  });

  it('creates category, brand and side synonyms with their target names and scripts', async () => {
    const cat = await call(manager, 'POST', '/admin/search/synonyms', { term: testTerm(runId, 'tmpl'), targetKind: 'category', targetId: catalog.partGroupId });
    expect(cat.statusCode).toBe(201);
    expect(cat.json().data.targetName).toBe(`${catalog.categoryName} › Test Loom › Test Temples`);
    const br = await call(manager, 'POST', '/admin/search/synonyms', { term: testTerm(runId, 'brnd'), targetKind: 'brand', targetId: brand.id });
    expect(br.json().data.targetName).toBe(brand.name);
    const side = await call(manager, 'POST', '/admin/search/synonyms', { term: `${testTerm(runId, 'बायाँ')}`, targetKind: 'side', targetSide: 'left' });
    expect(side.statusCode).toBe(201);
    expect(side.json().data).toMatchObject({ targetSide: 'left', script: 'devanagari' });
    const gu = await call(manager, 'POST', '/admin/search/synonyms', { term: testTerm(runId, 'ડાબું'), targetKind: 'side', targetSide: 'left' });
    expect(gu.json().data.script).toBe('gujarati');
  });

  it('lists with a text and target-kind filter, and pages with a cursor', async () => {
    const res = await call(manager, 'GET', `/admin/search/synonyms?q=${encodeURIComponent(testTerm(runId, ''))}&targetKind=side`);
    expect(res.statusCode).toBe(200);
    const page = res.json().data as { items: SearchSynonym[]; nextCursor: string | null };
    expect(page.items.map((s) => s.targetKind)).toEqual(['side', 'side']);
    const all = await listSynonyms(db, { q: testTerm(runId, '') }, { pageSize: 2 });
    expect(all.items).toHaveLength(2);
    const next = await listSynonyms(db, { q: testTerm(runId, '') }, { pageSize: 2, cursor: all.nextCursor! });
    expect(next.items.map((s) => s.id)).not.toContain(all.items[0]!.id);
    const bad = await call(manager, 'GET', `/admin/search/synonyms?cursor=abc`);
    expect(bad.json().code).toBe('CURSOR_INVALID');
    // The cursor is bound to its filters: reused with others it is refused.
    for (const filters of [{ q: testTerm(runId, 'x') }, { q: testTerm(runId, ''), targetKind: 'side' as const }, {}]) {
      await expect(listSynonyms(db, filters, { pageSize: 2, cursor: all.nextCursor! }), JSON.stringify(filters)).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    }
    const other = await call(manager, 'GET', `/admin/search/synonyms?targetKind=word&cursor=${encodeURIComponent(all.nextCursor!)}`);
    expect([other.statusCode, other.json().code]).toEqual([400, 'CURSOR_INVALID']);
  });

  it('a refused write leaves the reader version unchanged', async () => {
    const v0 = await readReaderVersion(app.redis);
    const dup = await call(manager, 'POST', '/admin/search/synonyms', { term: testTerm(runId, 'brnd'), targetKind: 'brand', targetId: brand.id });
    expect(dup.json().code).toBe('SYNONYM_EXISTS');
    const bad = await call(manager, 'POST', '/admin/search/synonyms', { term: testTerm(runId, 'b9'), targetKind: 'brand', targetId: randomUUID() });
    expect(bad.json().code).toBe('SYNONYM_TARGET_INVALID');
    const badPatch = await call(manager, 'PATCH', `/admin/search/synonyms/${wordId}`, { targetKind: 'category', targetId: brand.id });
    expect(badPatch.json().code).toBe('SYNONYM_TARGET_INVALID');
    expect(await readReaderVersion(app.redis)).toBe(v0);
  });

  it('updates with an audit before / after and a version bump; a duplicate is 409', async () => {
    const v0 = await readReaderVersion(app.redis);
    const res = await call(manager, 'PATCH', `/admin/search/synonyms/${wordId}`, { targetWord: 'tie rod ends', isActive: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ targetWord: 'tie rod ends', isActive: false, targetKind: 'word' });
    expect(await readReaderVersion(app.redis)).toBeGreaterThan(v0);
    const audit = await lastAudit('search_synonym.update', wordId);
    expect(audit!.before).toMatchObject({ targetWord: 'tie rod end', isActive: true });
    expect(audit!.after).toMatchObject({ targetWord: 'tie rod ends', isActive: false });

    const kind = await call(manager, 'PATCH', `/admin/search/synonyms/${wordId}`, { targetKind: 'brand', targetId: brand.id });
    expect(kind.json().data).toMatchObject({ targetKind: 'brand', targetId: brand.id, targetWord: null });
    const dup = await call(manager, 'PATCH', `/admin/search/synonyms/${wordId}`, { term: testTerm(runId, 'brnd') });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('SYNONYM_EXISTS');
    expect((await call(manager, 'PATCH', `/admin/search/synonyms/${randomUUID()}`, { isActive: true })).statusCode).toBe(404);
  });

  it('deletes with an audit row and a version bump', async () => {
    const v0 = await readReaderVersion(app.redis);
    const res = await call(manager, 'DELETE', `/admin/search/synonyms/${wordId}`);
    expect(res.statusCode).toBe(200);
    expect(await readReaderVersion(app.redis)).toBeGreaterThan(v0);
    const audit = await lastAudit('search_synonym.delete', wordId);
    expect(audit).toMatchObject({ after: null });
    expect(audit!.before).toMatchObject({ id: wordId });
    expect((await call(manager, 'DELETE', `/admin/search/synonyms/${wordId}`)).statusCode).toBe(404);
  });

  it('previews what the reader reads now', async () => {
    await call(manager, 'POST', '/admin/search/synonyms', { term: testTerm(runId, 'trx'), targetKind: 'word', targetWord: 'tie rod end' });
    const res = await call(manager, 'POST', '/admin/search/synonyms/preview', { q: `${testTerm(runId, 'trx')} ${testTerm(runId, 'बायाँ')} 12345` });
    expect(res.statusCode).toBe(200);
    const reading = res.json().data as QueryReading;
    expect(reading.side).toBe('left');
    expect(reading.words).toEqual([]);
    expect(reading.wordGroups).toEqual([{ typed: `${norm} trx`.split(' '), alternatives: [['tie', 'rod', 'end']] }]);
    expect(reading.partNumbers).toEqual(['12345']);
  });
});

describe('insights', () => {
  const now = new Date();
  const day = (back: number) => indiaDay(new Date(now.getTime() - back * 86_400_000));
  const q = (s: string) => `${norm} ${s}`;

  beforeAll(async () => {
    const rows: Array<typeof searchQueries.$inferInsert> = [];
    const add = (normalized: string, back: number, resultTotal: number, n = 1) => {
      for (let i = 0; i < n; i++) rows.push({ normalized, words: 2, resultTotal, day: day(back) });
    };
    add(q('nothing'), 0, 0, 2);
    add(q('nothing'), 3, 0);
    add(q('nothing'), 40, 0, 5); // outside the 30 days
    add(q('gear pump'), 0, 4, 2);
    add(q('gear pump'), 1, 4, 2);
    add(q('gear pump'), 2, 4);
    add(q('two days'), 0, 4, 3);
    add(q('two days'), 1, 4, 3);
    await db.insert(searchQueries).values(rows);
  });

  it('lists zero-result searches of the last 30 days', async () => {
    const res = await call(manager, 'GET', '/admin/search/zero-results');
    expect(res.statusCode).toBe(200);
    const mine = (res.json().data as ZeroResultRow[]).filter((r) => r.normalized.startsWith(norm));
    expect(mine).toEqual([{ normalized: q('nothing'), searches: 3, lastDay: day(0) }]);
    // A fake clock 28 days on: today's rows are 28 days back (in), the one 3 days back is now 31 (out).
    const later = await zeroResults(db, { now: new Date(now.getTime() + 28 * 86_400_000) });
    expect(later.filter((r) => r.normalized.startsWith(norm))).toEqual([{ normalized: q('nothing'), searches: 2, lastDay: day(0) }]);
    const muchLater = await zeroResults(db, { now: new Date(now.getTime() + 31 * 86_400_000) });
    expect(muchLater.filter((r) => r.normalized.startsWith(norm))).toEqual([]);
  });

  it('lists trending with distinct days, hides and unhides with audit rows', async () => {
    const res = await call(manager, 'GET', '/admin/search/trending');
    expect(res.statusCode).toBe(200);
    const mine = (res.json().data as TrendingRow[]).filter((r) => r.normalized.startsWith(norm));
    expect(mine).toEqual([{ normalized: q('gear pump'), searches: 5, days: 3, hidden: false }]);

    const enc = encodeURIComponent(q('gear pump'));
    const hide = await call(manager, 'PUT', `/admin/search/trending-hidden/${enc}`);
    expect(hide.statusCode).toBe(200);
    expect(hide.json().data).toEqual({ normalized: q('gear pump'), hidden: true });
    expect(await lastAudit('search_trending.hide', q('gear pump'))).toMatchObject({ adminId: manager.id, before: { hidden: false }, after: { hidden: true } });
    expect((await call(manager, 'PUT', `/admin/search/trending-hidden/${enc}`)).statusCode).toBe(200);

    const hidden = (await adminTrending(db, { now })).filter((r) => r.normalized.startsWith(norm));
    expect(hidden).toEqual([{ normalized: q('gear pump'), searches: 5, days: 3, hidden: true }]);
    expect(await trending(db, { now, top: 1000 })).not.toContain(q('gear pump'));

    const unhide = await call(manager, 'DELETE', `/admin/search/trending-hidden/${enc}`);
    expect(unhide.json().data).toEqual({ normalized: q('gear pump'), hidden: false });
    expect(await lastAudit('search_trending.unhide', q('gear pump'))).toMatchObject({ before: { hidden: true }, after: { hidden: false } });
    expect(await trending(db, { now, top: 1000 })).toContain(q('gear pump'));
    expect((await call(manager, 'PUT', `/admin/search/trending-hidden/${encodeURIComponent(' -- ')}`)).statusCode).toBe(400);
  });
});

describe('brand chip_needs_context', () => {
  it('is saved, audited and bumps the reader version; "bull gear" reads as words with it on, the chip with it off', async () => {
    const loader = createReaderDictionaryLoader();
    let t = 1_000_000;
    const clock = () => t;
    const read = async () => readQuery(`${bullName} gear`, await loader(db, app.redis, clock));

    const off = await read();
    expect(off.brand?.id).toBe(bullId);

    const v0 = await readReaderVersion(app.redis);
    const res = await call(manager, 'PATCH', `/admin/brands/${bullId}`, { chipNeedsContext: true });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as Brand).chipNeedsContext).toBe(true);
    expect(await readReaderVersion(app.redis)).toBeGreaterThan(v0);
    const audit = await lastAudit('brand.update', bullId);
    expect(audit!.before).toMatchObject({ chipNeedsContext: false });
    expect(audit!.after).toMatchObject({ chipNeedsContext: true });

    t += 1_000; // within 5 s of the last check: the cached dictionary
    expect((await read()).brand?.id).toBe(bullId);
    t += 5_000;
    const on = await read();
    expect(on.brand).toBeNull();
    expect(on.words).toEqual([bullName.toLowerCase(), 'gear']);

    await call(manager, 'PATCH', `/admin/brands/${bullId}`, { chipNeedsContext: false });
    t += 5_001;
    expect((await read()).brand?.id).toBe(bullId);

    const listed = await call(manager, 'GET', '/admin/brands');
    expect((listed.json().data as Brand[]).find((b) => b.id === bullId)?.chipNeedsContext).toBe(false);
    const created = await call(manager, 'POST', '/admin/brands', {
      key: `zztace_${runId}`, name: `Zztace${runId}`, makesMachines: true, makesParts: false, chipNeedsContext: true,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.chipNeedsContext).toBe(true);
    await deleteTestBrands([created.json().data.id]);
    expect(await db.select().from(brands).where(inArray(brands.id, [created.json().data.id]))).toEqual([]);
  });
});
