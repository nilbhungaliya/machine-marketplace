import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import {
  DISCOVERY_LIMITS,
  type QueryReading,
  type SearchScript,
  type SearchSide,
  type SearchSynonym,
  type SearchSynonymInput,
  type SearchSynonymPage,
  type SynonymTarget,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { brands, categories, machineModels, searchSynonyms } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isCheckViolation, isUniqueViolation } from '../../lib/pg-errors.js';
import { writeAudit } from '../audit.service.js';
import { cursorInvalid, openCursor, sealCursor } from './cursor.js';
import { normalizeSearchText } from './normalize.js';
import { publicReading, readQuery } from './query-reader.js';
import { fetchReaderDictionary } from './reader-dictionary.js';
import { afterCatalogCommit } from './refresh-jobs.js';

// Search synonyms admin (F4 + F5 spec §4.2, §7.1, §9; category_manager, super_admin passes). Every write runs in one
// transaction with its `audit_log` row (`search_synonym.create / update / delete`, before / after) and bumps the reader
// version key after it commits, so every API instance's query reader sees it within 5 s (§5.3).

type Conn = Db | Tx;
type SynonymRow = typeof searchSynonyms.$inferSelect;

const UNIQUE_INDEX = 'search_synonyms_term_target_uq';
const SHAPE_CHECK = 'search_synonyms_target_shape';
const SIDES: readonly SearchSide[] = ['left', 'right', 'pair'];
export const SYNONYM_PAGE_SIZE = 50;

const synonymExists = () => new ConflictError('This synonym already exists', 'SYNONYM_EXISTS');
const targetInvalid = (message: string) => new ValidationError(message, undefined, 'SYNONYM_TARGET_INVALID');

/** The term's script (§4.2): Devanagari or Gujarati when it has a letter of that script, else Latin. */
export function scriptOf(term: string): SearchScript {
  if (/[ऀ-ॿ]/.test(term)) return 'devanagari';
  if (/[઀-૿]/.test(term)) return 'gujarati';
  return 'latin';
}

/** A term the reader can use: non-empty once normalised, at most 4 words (§5.3 step 2). */
export function checkedTermNorm(term: string): string {
  const norm = normalizeSearchText(term);
  if (norm === '') throw new ValidationError('Type a word to match');
  if (norm.split(' ').length > DISCOVERY_LIMITS.maxSynonymPhraseWords) {
    throw new ValidationError(`A synonym has at most ${DISCOVERY_LIMITS.maxSynonymPhraseWords} words`);
  }
  return norm;
}

/** "Machine category › Machine type › Part group" for a category, the name for a brand or a model. */
async function targetNames(conn: Conn, rows: SynonymRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = (kind: SynonymTarget) => [...new Set(rows.filter((r) => r.targetKind === kind && r.targetId).map((r) => r.targetId!))];
  const brandIds = ids('brand');
  const modelIds = ids('model');
  const categoryIds = ids('category');
  if (brandIds.length) {
    for (const b of await conn.select({ id: brands.id, name: brands.name }).from(brands).where(inArray(brands.id, brandIds))) out.set(b.id, b.name);
  }
  if (modelIds.length) {
    for (const m of await conn.select({ id: machineModels.id, name: machineModels.name }).from(machineModels).where(inArray(machineModels.id, modelIds))) {
      out.set(m.id, m.name);
    }
  }
  if (categoryIds.length) {
    const nodes = await conn.select({ id: categories.id, path: categories.path }).from(categories).where(inArray(categories.id, categoryIds));
    const paths = [...new Set(nodes.flatMap((n) => n.path.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'))))];
    const names = new Map(
      paths.length
        ? (await conn.select({ path: categories.path, name: categories.name }).from(categories).where(inArray(categories.path, paths))).map((c) => [c.path, c.name])
        : [],
    );
    for (const n of nodes) {
      const parts = n.path.split('/');
      out.set(n.id, parts.map((_, i) => names.get(parts.slice(0, i + 1).join('/')) ?? '').filter(Boolean).join(' › '));
    }
  }
  return out;
}

function toSynonym(row: SynonymRow, names: Map<string, string>): SearchSynonym {
  return {
    id: row.id,
    term: row.term,
    termNorm: row.termNorm,
    script: row.script,
    targetKind: row.targetKind,
    targetId: row.targetId,
    targetSide: row.targetSide === 'left' || row.targetSide === 'right' || row.targetSide === 'pair' ? row.targetSide : null,
    targetWord: row.targetWord,
    targetName: row.targetId ? (names.get(row.targetId) ?? null) : null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function toSynonyms(conn: Conn, rows: SynonymRow[]): Promise<SearchSynonym[]> {
  const names = await targetNames(conn, rows);
  return rows.map((r) => toSynonym(r, names));
}

interface Target {
  targetKind: SynonymTarget;
  targetId: string | null;
  targetSide: SearchSide | null;
  targetWord: string | null;
}

/**
 * Exactly the field of the kind is set (CHECK `search_synonyms_target_shape`), and a category, brand or model target
 * exists and is active (a model's brand too): else `400 SYNONYM_TARGET_INVALID`. A word target is stored normalised.
 */
async function checkedTarget(
  tx: Tx,
  input: { targetKind: SynonymTarget; targetId?: string | null; targetSide?: string | null; targetWord?: string | null },
): Promise<Target> {
  const { targetKind: kind } = input;
  const id = input.targetId ?? null;
  const side = input.targetSide ?? null;
  const word = input.targetWord ?? null;
  const only = (field: 'id' | 'side' | 'word') => {
    const set = { id: id !== null, side: side !== null, word: word !== null };
    if (!set[field] || Object.entries(set).some(([k, v]) => k !== field && v)) {
      throw targetInvalid(`A ${kind} synonym points at a ${field === 'id' ? kind : field} only`);
    }
  };
  if (kind === 'side') {
    only('side');
    if (!SIDES.includes(side as SearchSide)) throw targetInvalid('A side synonym points at left, right or pair');
    return { targetKind: kind, targetId: null, targetSide: side as SearchSide, targetWord: null };
  }
  if (kind === 'word') {
    only('word');
    const norm = normalizeSearchText(word);
    if (norm === '') throw targetInvalid('Type the words to search for');
    return { targetKind: kind, targetId: null, targetSide: null, targetWord: norm };
  }
  only('id');
  let found: unknown;
  if (kind === 'category') {
    [found] = await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.id, id!), eq(categories.isActive, true)));
  } else if (kind === 'brand') {
    [found] = await tx.select({ id: brands.id }).from(brands).where(and(eq(brands.id, id!), eq(brands.isActive, true)));
  } else {
    [found] = await tx
      .select({ id: machineModels.id })
      .from(machineModels)
      .innerJoin(brands, eq(brands.id, machineModels.brandId))
      .where(and(eq(machineModels.id, id!), eq(machineModels.isActive, true), eq(brands.isActive, true)));
  }
  if (!found) throw targetInvalid(`Choose an active ${kind}`);
  return { targetKind: kind, targetId: id, targetSide: null, targetWord: null };
}

/** The unique index and the shape CHECK are the race backstops. */
async function mapViolations<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isUniqueViolation(err, UNIQUE_INDEX)) throw synonymExists();
    if (isCheckViolation(err, SHAPE_CHECK)) throw targetInvalid('The target does not match its kind');
    throw err;
  }
}

/** SYNONYM_EXISTS before the write, for a clear error (the unique index backs it). */
async function assertFree(tx: Tx, termNorm: string, t: Target, exceptId?: string): Promise<void> {
  const [clash] = await tx
    .select({ id: searchSynonyms.id })
    .from(searchSynonyms)
    .where(
      and(
        eq(searchSynonyms.termNorm, termNorm),
        eq(searchSynonyms.targetKind, t.targetKind),
        t.targetId ? eq(searchSynonyms.targetId, t.targetId) : sql`${searchSynonyms.targetId} IS NULL`,
        t.targetSide ? eq(searchSynonyms.targetSide, t.targetSide) : sql`${searchSynonyms.targetSide} IS NULL`,
        t.targetWord ? eq(searchSynonyms.targetWord, t.targetWord) : sql`${searchSynonyms.targetWord} IS NULL`,
        exceptId ? sql`${searchSynonyms.id} <> ${exceptId}` : undefined,
      ),
    )
    .limit(1);
  if (clash) throw synonymExists();
}

// ─── Reads ───

export interface SynonymFilters {
  q?: string;
  targetKind?: SynonymTarget;
}

interface SynonymCursor {
  termNorm: string;
  id: string;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function listAad(filters: SynonymFilters): string {
  const hash = createHash('sha256').update(JSON.stringify([filters.q ?? '', filters.targetKind ?? ''])).digest('hex');
  return `synonyms:${hash}`;
}

/** `GET /admin/search/synonyms`: by normalised term, then id; `q` matches the term (as typed or normalised) or the words. */
export async function listSynonyms(
  conn: Conn,
  filters: SynonymFilters,
  opts: { cursor?: string | null; pageSize?: number } = {},
): Promise<SearchSynonymPage> {
  const size = opts.pageSize ?? SYNONYM_PAGE_SIZE;
  const aad = listAad(filters);
  let after: SynonymCursor | null = null;
  if (opts.cursor) {
    after = openCursor<SynonymCursor>(opts.cursor, aad);
    if (typeof after.termNorm !== 'string' || typeof after.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(after.id)) throw cursorInvalid();
  }
  const conds: SQL[] = [];
  const raw = filters.q?.trim() ?? '';
  if (raw) {
    const norm = normalizeSearchText(raw);
    const textConds: SQL[] = [sql`${searchSynonyms.term} ILIKE ${`%${likeEscape(raw)}%`}`];
    if (norm) {
      textConds.push(sql`${searchSynonyms.termNorm} LIKE ${`%${likeEscape(norm)}%`}`);
      textConds.push(sql`${searchSynonyms.targetWord} LIKE ${`%${likeEscape(norm)}%`}`);
    }
    conds.push(or(...textConds)!);
  }
  if (filters.targetKind) conds.push(eq(searchSynonyms.targetKind, filters.targetKind));
  if (after) conds.push(sql`(${searchSynonyms.termNorm}, ${searchSynonyms.id}) > (${after.termNorm}, ${after.id}::uuid)`);

  const rows = await conn
    .select()
    .from(searchSynonyms)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(searchSynonyms.termNorm), asc(searchSynonyms.id))
    .limit(size + 1);
  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  return {
    items: await toSynonyms(conn, page),
    nextCursor: rows.length > size && last ? sealCursor({ termNorm: last.termNorm, id: last.id } satisfies SynonymCursor, aad) : null,
  };
}

/** `POST /admin/search/synonyms/preview`: what the reader reads now (the database as it is, no cache). */
export async function previewReading(db: Db, q: string): Promise<QueryReading> {
  return publicReading(readQuery(q, await fetchReaderDictionary(db)));
}

// ─── Writes ───

/** `SearchSynonymInput` as the route parsed it: the side is checked here (`400 SYNONYM_TARGET_INVALID`), not by Zod. */
export type SynonymWriteInput = Omit<SearchSynonymInput, 'targetSide'> & { targetSide?: string | null };

export async function createSynonym(db: Db, adminId: string, input: SynonymWriteInput, redis?: Redis | null): Promise<SearchSynonym> {
  const termNorm = checkedTermNorm(input.term);
  const result = await mapViolations(() =>
    db.transaction(async (tx) => {
      const target = await checkedTarget(tx, input);
      await assertFree(tx, termNorm, target);
      const [row] = await tx
        .insert(searchSynonyms)
        .values({
          term: input.term.trim(),
          termNorm,
          script: scriptOf(input.term),
          ...target,
          isActive: input.isActive ?? true,
          createdBy: adminId,
          updatedBy: adminId,
        })
        .returning();
      const [after] = await toSynonyms(tx, [row!]);
      await writeAudit(tx, { adminId, action: 'search_synonym.create', entityType: 'search_synonym', entityId: row!.id, before: null, after });
      return after!;
    }),
  );
  await afterCatalogCommit(redis);
  return result;
}

const TARGET_KEYS = ['targetKind', 'targetId', 'targetSide', 'targetWord'] as const;

/**
 * Any subset of the input. A patch naming the kind or any target field restates the whole target (the kind defaults to
 * the current one; target fields left out are cleared), and is checked; otherwise the target is kept as it is.
 */
export async function updateSynonym(
  db: Db,
  adminId: string,
  id: string,
  patch: Partial<SynonymWriteInput>,
  redis?: Redis | null,
): Promise<SearchSynonym> {
  const termNorm = patch.term !== undefined ? checkedTermNorm(patch.term) : undefined;
  const result = await mapViolations(() =>
    db.transaction(async (tx) => {
      const [current] = await tx.select().from(searchSynonyms).where(eq(searchSynonyms.id, id)).for('update');
      if (!current) throw new NotFoundError('Synonym');
      const retarget = TARGET_KEYS.some((k) => patch[k] !== undefined);
      const target: Target = retarget
        ? await checkedTarget(tx, { ...patch, targetKind: patch.targetKind ?? current.targetKind })
        : {
            targetKind: current.targetKind,
            targetId: current.targetId,
            targetSide: current.targetSide as SearchSide | null,
            targetWord: current.targetWord,
          };
      const nextNorm = termNorm ?? current.termNorm;
      if (retarget || termNorm !== undefined) await assertFree(tx, nextNorm, target, id);

      const [row] = await tx
        .update(searchSynonyms)
        .set({
          ...(patch.term !== undefined ? { term: patch.term.trim(), termNorm: nextNorm, script: scriptOf(patch.term) } : {}),
          ...target,
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
          updatedBy: adminId,
          updatedAt: new Date(),
        })
        .where(eq(searchSynonyms.id, id))
        .returning();
      const [before, after] = await toSynonyms(tx, [current, row!]);
      await writeAudit(tx, { adminId, action: 'search_synonym.update', entityType: 'search_synonym', entityId: id, before, after });
      return after!;
    }),
  );
  await afterCatalogCommit(redis);
  return result;
}

export async function deleteSynonym(db: Db, adminId: string, id: string, redis?: Redis | null): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(searchSynonyms).where(eq(searchSynonyms.id, id)).for('update');
    if (!current) throw new NotFoundError('Synonym');
    const [before] = await toSynonyms(tx, [current]);
    await tx.delete(searchSynonyms).where(eq(searchSynonyms.id, id));
    await writeAudit(tx, { adminId, action: 'search_synonym.delete', entityType: 'search_synonym', entityId: id, before, after: null });
  });
  await afterCatalogCommit(redis);
}
