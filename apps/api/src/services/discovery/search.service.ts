import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import {
  cleanFilters,
  DEFAULT_RADIUS_KM,
  DISCOVERY_LIMITS,
  DISCOVERY_RADII_KM,
  type CountOnlyResult,
  type DiscoveryRadiusKm,
  type ListingKind,
  type SearchCountRequest,
  type SearchPage,
  type SearchRequest,
  type SearchResponse,
  type SearchSide,
  type SearchSort,
  type SearchWiden,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { categories, listings } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { loadCards } from '../listings/listing-view.service.js';
import type { ListingRow } from '../listings/locks.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import { cursorAad, cursorInvalid, openCursor, requestHash, sealCursor, type CursorPayload } from './cursor.js';
import { snappedKmSql } from './distance.js';
import { computeFacets } from './facets.js';
import { filterNotAvailable, filterParts, priceSql, specFieldsInPlay, whereSql, type FilterParts, type SpecFieldInPlay } from './filters.js';
import { fullMatchSql, matchScoreSql, partialMatchSql, type MatchTerms } from './matching.js';
import { normalizeSearchText, searchTokens } from './normalize.js';
import { resolveOrigin, type OriginViewer, type ResolvedOrigin } from './origin.js';
import { applyRemovedChips, publicReading, readQuery, type ReadQueryResult } from './query-reader.js';
import { loadReaderDictionary, type DictionaryLoader } from './reader-dictionary.js';
import { relevanceSql, tierSql } from './ranking.js';
import { logSearch } from './search-log.service.js';

// Search (F4 + F5 spec §5): one read-only transaction per search or count that first sets the trigram threshold
// (§5.4), then the items, the total, the widen counts and the facets one after another on its connection. Order: tier
// first in every sort (R6, R7), then the sort key(s), then id; a sealed keyset cursor carries the first page's time.

const MACHINE_KINDS: readonly ListingKind[] = ['machine', 'machine_rental'];
/** Stands in for NULL in a sort key so every key is a number (NULLs sort last). */
const NULL_KEY = 1e18;
/** Best match: `match · 1e5 + clamp(relevance · 1000, 0, 99 999)` (§5.5). */
const MATCH_SCALE = 100_000;

export interface SearchViewer {
  userId: string;
  businessId: string | null;
}

export interface SearchDeps {
  redis?: Redis | null;
  /** The reader dictionary loader (the process's one by default). */
  dictionary?: DictionaryLoader;
  /** The clock for `asOf` on a first page (tests). */
  now?: () => Date;
}

/** The cursor of a search page: §5.10's payload, plus whether the list is a partial one. */
interface SearchCursor extends CursorPayload {
  partial?: boolean;
}

/** Everything a request resolves to before any listing is read. */
export interface PreparedSearch {
  reading: ReadQueryResult;
  filters: ReturnType<typeof cleanFilters>;
  origin: ResolvedOrigin;
  radiusKm: number | null;
  sort: SearchSort;
  side: SearchSide | null;
  kinds: ListingKind[];
  parts: FilterParts;
  terms: MatchTerms;
  specFields: SpecFieldInPlay[];
  aad: string;
}

function invalid(code: string, message: string): ValidationError {
  return new ValidationError(message, undefined, code);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A sealed cursor is ours, but its shape is still checked before it reaches SQL. */
function checkedCursor(c: SearchCursor): SearchCursor {
  if (typeof c.asOf !== 'string' || !finite(c.tier) || !finite(c.key) || !(c.key2 === null || finite(c.key2))) throw cursorInvalid();
  if (typeof c.id !== 'string' || !UUID_RE.test(c.id)) throw cursorInvalid();
  return c;
}

/** The listing whose ref this is, when it is public. */
async function publicRef(conn: Db | Tx, ref: number): Promise<{ id: string; ref: number } | null> {
  if (!Number.isSafeInteger(ref)) return null;
  const [row] = await conn
    .select({ id: listings.id, ref: listings.ref })
    .from(listings)
    .where(sql`${listings.ref} = ${ref} AND ${publicListingWhere(listings)}`)
    .limit(1);
  return row ?? null;
}

/**
 * Resolves a request (reader, chips, overrides, origin, sort, filters) inside the search transaction. Explicit filters
 * override the reader's chips of the same kind (§5.3): `side`, `categoryId`, and `fit` (brand / model).
 */
export async function prepareSearch(
  tx: Tx,
  req: SearchCountRequest,
  reading: ReadQueryResult,
  viewer: OriginViewer,
): Promise<PreparedSearch> {
  const filters = cleanFilters(req.filters);
  const origin = await resolveOrigin(tx, req.origin ?? undefined, viewer);
  const kinds = [...(filters.kinds ?? [])].sort() as ListingKind[];

  const r: ReadQueryResult = { ...reading, chipWords: { ...reading.chipWords } };
  if (filters.side) r.side = filters.side;
  if (filters.fit) {
    r.brand = null;
    r.model = null;
  }
  // The category in play: the filter, else the reader's chip.
  let categoryPath: string | null = null;
  if (filters.categoryId) {
    const [node] = await tx
      .select({ id: categories.id, name: categories.name, level: categories.level, path: categories.path })
      .from(categories)
      .where(eq(categories.id, filters.categoryId));
    if (!node) throw filterNotAvailable('categoryId');
    r.category = { id: node.id, name: node.name, level: node.level };
    categoryPath = node.path;
  } else if (r.category) {
    const [node] = await tx.select({ path: categories.path }).from(categories).where(eq(categories.id, r.category.id));
    categoryPath = node?.path ?? null;
  }

  const hasText = r.words.length > 0 || r.partNumbers.length > 0;
  const sort: SearchSort = req.sort ?? (hasText ? 'best_match' : origin.point ? 'nearest' : 'newest');
  if (sort === 'nearest' && !origin.point) throw invalid('LOCATION_REQUIRED', 'Choose a location to sort by distance');
  if ((sort === 'year_desc' || sort === 'hours_asc') && (kinds.length === 0 || kinds.some((k) => !MACHINE_KINDS.includes(k)))) {
    throw invalid('SORT_NEEDS_MACHINES', 'This sort is for machines only');
  }

  const radiusKm = origin.point ? (filters.radiusKm === undefined ? DEFAULT_RADIUS_KM : filters.radiusKm) : null;
  const specFields = await specFieldsInPlay(tx, categoryPath, kinds);
  if (filters.specs && !categoryPath) throw filterNotAvailable('specs');
  const side = r.side;
  const parts = filterParts({
    filters,
    kinds,
    side,
    categoryPath,
    brandChipId: r.brand?.id ?? null,
    modelChipId: r.model?.id ?? null,
    modelChipBrandId: r.model?.brandId ?? null,
    origin: origin.point,
    radiusKm,
    specFields,
  });

  const hash = requestHash({
    q: normalizeSearchText(req.q),
    filters,
    removedChips: [...new Set(req.removedChips ?? [])].sort(),
    origin: req.origin ?? null,
  });
  return {
    reading: r,
    filters,
    origin,
    radiusKm,
    sort,
    side,
    kinds,
    parts,
    terms: { words: r.words, partNumbers: r.partNumbers, side },
    specFields,
    aad: cursorAad(sort, hash),
  };
}

/** The sort keys (§5.5, §5.8): `sk` and `sk2`, both numbers, DESC; NULLs last through `NULL_KEY`. */
function sortKeys(p: PreparedSearch, asOf: Date): { sk: SQL; sk2: SQL } {
  const relevance = relevanceSql({ asOf, origin: p.origin.point, radiusKm: p.radiusKm });
  const neg = (x: SQL) => sql`(-COALESCE((${x})::float8, ${NULL_KEY}::float8))`;
  const pos = (x: SQL) => sql`COALESCE((${x})::float8, ${-NULL_KEY}::float8)`;
  const zero = sql`0::float8`;
  switch (p.sort) {
    case 'best_match':
      return {
        sk: sql`((${matchScoreSql(p.terms)})::float8 * ${MATCH_SCALE}::float8 + LEAST(GREATEST(${relevance} * 1000, 0), ${MATCH_SCALE - 1})::float8)`,
        sk2: zero,
      };
    case 'nearest':
      return { sk: neg(snappedKmSql(listings.searchPoint, p.origin.point!)), sk2: relevance };
    case 'newest':
      return { sk: pos(sql`floor(EXTRACT(EPOCH FROM ${listings.refreshedAt}) * 1000000)`), sk2: zero };
    case 'price_asc':
      return { sk: neg(priceSql), sk2: zero };
    case 'price_desc':
      return { sk: pos(priceSql), sk2: zero };
    case 'year_desc':
      return { sk: pos(sql`(SELECT m.year FROM listing_machines m WHERE m.listing_id = ${listings.id})`), sk2: zero };
    case 'hours_asc':
      return { sk: neg(sql`(SELECT m.hours_run FROM listing_machines m WHERE m.listing_id = ${listings.id})`), sk2: zero };
  }
}

/** The WHERE of a search: visibility, filters, radius (unless left out for widen) and the text match of the mode. */
export function searchWhere(p: PreparedSearch, mode: 'full' | 'partial', opts: { radius?: boolean; asOf?: Date | null } = {}): SQL {
  const match = mode === 'full' ? fullMatchSql(p.terms) : partialMatchSql(p.terms);
  const asOf = opts.asOf ? sql`${listings.refreshedAt} <= ${opts.asOf.toISOString()}::timestamptz` : null;
  return whereSql(p.parts, p.kinds, [match, asOf], [], opts.radius !== false);
}

/** The items query of one page (also used by the EXPLAIN tests). */
export function pageSql(p: PreparedSearch, mode: 'full' | 'partial', asOf: Date, after: SearchCursor | null, limit: number): SQL {
  const { sk, sk2 } = sortKeys(p, asOf);
  const keyset = after
    ? sql`WHERE (s.tier < ${after.tier} OR (s.tier = ${after.tier} AND (s.sk < ${Number(after.key)}::float8
        OR (s.sk = ${Number(after.key)}::float8 AND (s.sk2 < ${after.key2 ?? 0}::float8
        OR (s.sk2 = ${after.key2 ?? 0}::float8 AND s.id > ${after.id}::uuid))))))`
    : sql``;
  return sql`
    SELECT s.id, s.tier, s.sk, s.sk2 FROM (
      SELECT ${listings.id} AS id, ${tierSql({ side: p.side })} AS tier, (${sk})::float8 AS sk, (${sk2})::float8 AS sk2
      FROM listings
      WHERE ${searchWhere(p, mode, { asOf })}
    ) s
    ${keyset}
    ORDER BY s.tier DESC, s.sk DESC, s.sk2 DESC, s.id ASC
    LIMIT ${limit}`;
}

/** The count query of a mode (also used by the EXPLAIN tests). */
export function countSql(p: PreparedSearch, mode: 'full' | 'partial', asOf: Date | null = null): SQL {
  return sql`SELECT count(*)::int AS n FROM listings WHERE ${searchWhere(p, mode, { asOf })}`;
}

async function countOf(tx: Tx, p: PreparedSearch, mode: 'full' | 'partial'): Promise<number> {
  if (mode === 'partial' && p.terms.words.length < 2) return 0;
  const { rows } = await tx.execute<{ n: number }>(countSql(p, mode));
  return Number(rows[0]?.n ?? 0);
}

/**
 * Widen (§5.6): from FULL matches, the smallest larger radius than the one in play that has any, with its count; All
 * India when only beyond 200 km. Null without an origin or a radius, or when nothing matches anywhere.
 */
async function widenOf(tx: Tx, p: PreparedSearch): Promise<SearchWiden | null> {
  if (!p.origin.point || p.radiusKm === null) return null;
  const larger = DISCOVERY_RADII_KM.filter((r) => r > p.radiusKm!);
  const km = snappedKmSql(listings.searchPoint, p.origin.point);
  const cols = larger.map((r) => sql`count(*) FILTER (WHERE ${km} <= ${r})::int AS ${sql.identifier(`r${r}`)}`);
  const { rows } = await tx.execute<Record<string, number>>(sql`
    SELECT ${sql.join([...cols, sql`count(*)::int AS all_india`], sql`, `)}
    FROM listings WHERE ${searchWhere(p, 'full', { radius: false })}`);
  const row = rows[0] ?? {};
  for (const r of larger) {
    const n = Number(row[`r${r}`] ?? 0);
    if (n > 0) return { radiusKm: r as DiscoveryRadiusKm, count: n };
  }
  const all = Number(row.all_india ?? 0);
  return all > 0 ? { radiusKm: null, count: all } : null;
}

/** Runs `fn` in one read-only transaction that first sets the trigram threshold for itself only (§5.4). */
export async function inSearchTransaction<T>(db: Db, threshold: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(
    async (tx) => {
      await tx.execute(sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(threshold)}, true)`);
      return fn(tx);
    },
    { accessMode: 'read only' },
  );
}

/** The reader's reading of a request: `removedChips` applied. */
async function readingOf(db: Db, deps: SearchDeps, q: string | undefined, removed: SearchRequest['removedChips']): Promise<ReadQueryResult> {
  const dict = await (deps.dictionary ?? loadReaderDictionary)(db, deps.redis);
  return applyRemovedChips(readQuery(q, dict), removed);
}

/** `POST /discover/search` (§5, §7). */
export async function search(db: Db, req: SearchRequest, viewer: SearchViewer | null, deps: SearchDeps = {}): Promise<SearchResponse> {
  let q = req.q ?? '';
  let reading = await readingOf(db, deps, q, req.removedChips);

  // `#ref` (§5.3 step 1): a public listing's ref redirects; otherwise the number is read as typed without the `#`.
  if (reading.ref !== null) {
    const hit = req.cursor ? null : await publicRef(db, reading.ref);
    if (hit) return { redirect: { listingId: hit.id } };
    q = q.replace(/#(\d)/g, '$1');
    reading = await readingOf(db, deps, q, req.removedChips);
  }

  const result = await inSearchTransaction(db, DISCOVERY_LIMITS.trigramThreshold, async (tx) => {
    const p = await prepareSearch(tx, req, reading, viewer);
    const cursor = req.cursor ? checkedCursor(openCursor<SearchCursor>(req.cursor, p.aad)) : null;
    const asOf = cursor ? new Date(cursor.asOf) : (deps.now?.() ?? new Date());
    if (Number.isNaN(asOf.getTime())) throw cursorInvalid();

    let mode: 'full' | 'partial' = cursor?.partial ? 'partial' : 'full';
    let total: number | null = null;
    let widen: SearchWiden | null = null;
    if (!cursor) {
      total = await countOf(tx, p, 'full');
      if (total === 0) {
        widen = await widenOf(tx, p);
        const partialTotal = await countOf(tx, p, 'partial');
        if (partialTotal > 0) {
          mode = 'partial';
          total = partialTotal;
        }
      }
    }

    const size = DISCOVERY_LIMITS.pageSize;
    const { rows } = await tx.execute<{ id: string; tier: number; sk: number; sk2: number }>(pageSql(p, mode, asOf, cursor, size + 1));
    const page = rows.slice(0, size);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > size && last
        ? sealCursor(
            { asOf: asOf.toISOString(), tier: Number(last.tier), key: Number(last.sk), key2: Number(last.sk2), id: last.id, ...(mode === 'partial' ? { partial: true } : {}) },
            p.aad,
          )
        : null;

    const ids = page.map((r) => r.id);
    const loaded = ids.length ? await tx.select().from(listings).where(inArray(listings.id, ids)) : [];
    const byId = new Map(loaded.map((r) => [r.id, r as ListingRow]));
    const items = await loadCards(
      tx,
      ids.map((id) => byId.get(id)).filter((r): r is ListingRow => r !== undefined),
      { viewerUserId: viewer?.userId ?? null, origin: p.origin.point, side: p.side },
    );

    const facets = cursor ? null : await computeFacets(tx, p.parts, p.kinds, mode === 'full' ? fullMatchSql(p.terms) : partialMatchSql(p.terms), p.specFields);

    // A bare number equal to a public listing's ref (§5.3 step 1): a "Listing #…" row above the results.
    let refSuggestion: SearchPage['refSuggestion'] = null;
    if (!cursor && reading.ref === null) {
      const numbers = searchTokens(q).filter((t) => /^\d{6,15}$/.test(t));
      for (const n of numbers) {
        const hit = await publicRef(tx, Number(n));
        if (hit) {
          refSuggestion = { listingId: hit.id, ref: hit.ref };
          break;
        }
      }
    }

    const out: SearchPage = {
      items,
      nextCursor,
      total,
      sort: p.sort,
      reading: publicReading(p.reading),
      partial: mode === 'partial',
      widen,
      refSuggestion,
      facets,
      origin: p.origin.echo,
    };
    return { page: out, kinds: p.kinds, prepared: p };
  });

  // The anonymous log (§5.13): first page, words or part numbers, after the read-only transaction.
  const r = result.prepared.reading;
  if (!req.cursor && (r.words.length > 0 || r.partNumbers.length > 0)) {
    await logSearch(db, {
      raw: req.q ?? '',
      normalized: normalizeSearchText(req.q),
      words: r.words.length + r.partNumbers.length,
      resultTotal: result.page.total ?? 0,
      kind: result.kinds.length === 1 ? result.kinds[0]! : null,
    });
  }
  return result.page;
}

/** `POST /discover/search/count` (§5.11): the same request without a cursor; no items, facets or log. */
export async function countSearch(db: Db, req: SearchCountRequest, viewer: SearchViewer | null, deps: SearchDeps = {}): Promise<CountOnlyResult> {
  let q = req.q ?? '';
  let reading = await readingOf(db, deps, q, req.removedChips);
  if (reading.ref !== null) {
    q = q.replace(/#(\d)/g, '$1');
    reading = await readingOf(db, deps, q, req.removedChips);
  }
  return inSearchTransaction(db, DISCOVERY_LIMITS.trigramThreshold, async (tx) => {
    const p = await prepareSearch(tx, req, reading, viewer);
    const total = await countOf(tx, p, 'full');
    const partialTotal = total === 0 && p.terms.words.length >= 2 ? await countOf(tx, p, 'partial') : null;
    return { total, partialTotal };
  });
}

/** For the EXPLAIN tests: the prepared request inside a caller's transaction. */
export async function prepareForExplain(tx: Tx, db: Db, req: SearchCountRequest, deps: SearchDeps = {}): Promise<PreparedSearch> {
  const reading = await readingOf(db, deps, req.q, req.removedChips);
  return prepareSearch(tx, req, reading, null);
}
