import { sql } from 'drizzle-orm';
import { DISCOVERY_LIMITS, type Suggestion } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import { charLength, normalizeSearchText } from './normalize.js';
import { inSearchTransaction } from './search.service.js';
import { discoveryWhere } from './visibility.js';

// Suggestions (F4 + F5 spec §5.12): part groups and machine types, brands, models (name prefix or substring, a typo at
// word similarity 0.5, or a synonym of that target), and a listing entry for a public listing's ref. Each carries its
// All India public count from an in-process map refreshed at most every 90 s; zero-count entries are dropped.

type Conn = Db | Tx;

/** Public listing counts by `category:<id>` (subtree), `brand:<id>` and `model:<id>`. */
export type SuggestCounts = Map<string, number>;

/** One grouped read of every count (categories by subtree; brands by part brand, fitment or machine; models likewise). */
export async function fetchSuggestCounts(conn: Conn): Promise<SuggestCounts> {
  const visible = discoveryWhere(listings);
  const { rows } = await conn.execute<{ k: string; n: number }>(sql`
    WITH v AS (SELECT ${listings.id} AS id, ${listings.categoryId} AS category_id, ${listings.partBrandId} AS part_brand_id
               FROM listings WHERE ${visible})
    SELECT 'category:' || c.id AS k, count(DISTINCT v.id)::int AS n
      FROM v JOIN categories lc ON lc.id = v.category_id
      JOIN categories c ON lc.path = c.path OR lc.path LIKE c.path || '/%'
      GROUP BY c.id
    UNION ALL
    SELECT 'brand:' || x.brand_id, count(DISTINCT x.id)::int FROM (
        SELECT v.id, v.part_brand_id AS brand_id FROM v WHERE v.part_brand_id IS NOT NULL
        UNION ALL SELECT v.id, f.brand_id FROM v JOIN listing_fitments f ON f.listing_id = v.id
        UNION ALL SELECT v.id, m.brand_id FROM v JOIN listing_machines m ON m.listing_id = v.id WHERE m.brand_id IS NOT NULL
      ) x GROUP BY x.brand_id
    UNION ALL
    SELECT 'model:' || x.model_id, count(DISTINCT x.id)::int FROM (
        SELECT v.id, f.model_id FROM v JOIN listing_fitments f ON f.listing_id = v.id WHERE f.model_id IS NOT NULL
        UNION ALL SELECT v.id, m.model_id FROM v JOIN listing_machines m ON m.listing_id = v.id WHERE m.model_id IS NOT NULL
      ) x GROUP BY x.model_id`);
  return new Map(rows.map((r) => [r.k, Number(r.n)]));
}

export type SuggestCountLoader = (conn: Conn, now?: () => number) => Promise<SuggestCounts>;

/** A cached count map (one per process): re-read when older than `suggestCountCacheMs`. */
export function createSuggestCountLoader(fetch: (conn: Conn) => Promise<SuggestCounts> = fetchSuggestCounts): SuggestCountLoader {
  let cached: { at: number; counts: SuggestCounts } | null = null;
  return async (conn, now = Date.now) => {
    const t = now();
    if (cached && t - cached.at < DISCOVERY_LIMITS.suggestCountCacheMs) return cached.counts;
    const counts = await fetch(conn);
    cached = { at: t, counts };
    return counts;
  };
}

const defaultCounts = createSuggestCountLoader();

interface Candidate {
  type: 'category' | 'brand' | 'model';
  id: string;
  name: string;
  path: string[];
  /** 0 name prefix, 1 substring or synonym, 2 typo. */
  rank: number;
}

/** Category, brand and model candidates for a normalised query (inside the 0.5-threshold transaction). */
async function candidates(tx: Tx, q: string): Promise<Candidate[]> {
  const prefix = `${q}%`;
  const inside = `%${q}%`;
  const typo = charLength(q) >= 3 ? sql`${q}::text <% mpm_normalize_search(n.name)` : sql`false`;
  const synonym = (kind: string, idCol: ReturnType<typeof sql>) =>
    sql`EXISTS (SELECT 1 FROM search_synonyms s WHERE s.is_active AND s.target_kind = ${kind} AND s.target_id = ${idCol}
        AND s.term_norm LIKE ${prefix})`;
  const rank = sql`(CASE WHEN mpm_normalize_search(n.name) LIKE ${prefix} THEN 0
    WHEN mpm_normalize_search(n.name) LIKE ${inside} THEN 1 WHEN ${typo} THEN 2 ELSE 1 END)`;
  const { rows } = await tx.execute<{ type: Candidate['type']; id: string; name: string; path: string[] | null; rank: number }>(sql`
    SELECT 'category' AS type, n.id, n.name,
      (SELECT array_agg(a.name ORDER BY length(a.path)) FROM categories a
        WHERE n.path LIKE a.path || '/%') AS path, ${rank} AS rank
    FROM categories n
    WHERE n.is_active AND n.level IN ('part_group', 'machine_type')
      AND (mpm_normalize_search(n.name) LIKE ${inside} OR ${typo} OR ${synonym('category', sql`n.id`)})
    UNION ALL
    SELECT 'brand', n.id, n.name, ARRAY[]::text[], ${rank}
    FROM brands n
    WHERE n.is_active AND (mpm_normalize_search(n.name) LIKE ${inside} OR ${typo} OR ${synonym('brand', sql`n.id`)})
    UNION ALL
    SELECT 'model', n.id, n.name, ARRAY[b.name], ${rank}
    FROM machine_models n JOIN brands b ON b.id = n.brand_id AND b.is_active
    WHERE n.is_active AND (mpm_normalize_search(n.name) LIKE ${inside} OR ${typo} OR ${synonym('model', sql`n.id`)})`);
  return rows.map((r) => ({ type: r.type, id: r.id, name: r.name, path: r.path ?? [], rank: Number(r.rank) }));
}

export interface SuggestDeps {
  counts?: SuggestCountLoader;
  now?: () => number;
}

/** `GET /discover/suggest?q=` (§5.12): at most 8, a ref's listing first, then by match and count. */
export async function suggest(db: Db, rawQ: string | undefined, deps: SuggestDeps = {}): Promise<Suggestion[]> {
  const q = normalizeSearchText(rawQ);
  if (charLength(q.replace(/ /g, '')) < DISCOVERY_LIMITS.suggestMinChars) return [];
  return inSearchTransaction(db, DISCOVERY_LIMITS.suggestTrigramThreshold, async (tx) => {
    const out: Suggestion[] = [];
    const refText = (rawQ ?? '').trim().replace(/^#/, '');
    if (/^\d{1,15}$/.test(refText)) {
      const [hit] = await tx
        .select({ id: listings.id, ref: listings.ref, title: listings.title })
        .from(listings)
        .where(sql`${listings.ref} = ${Number(refText)} AND ${publicListingWhere(listings)}`)
        .limit(1);
      if (hit) out.push({ type: 'listing', id: hit.id, name: hit.title ?? '', path: [], liveCount: 1, ref: hit.ref });
    }
    const counts = await (deps.counts ?? defaultCounts)(tx, deps.now);
    const found = (await candidates(tx, q))
      .map((c) => ({ ...c, liveCount: counts.get(`${c.type}:${c.id}`) ?? 0 }))
      .filter((c) => c.liveCount > 0)
      .sort((a, b) => a.rank - b.rank || b.liveCount - a.liveCount || a.name.localeCompare(b.name));
    for (const c of found) out.push({ type: c.type, id: c.id, name: c.name, path: c.path, liveCount: c.liveCount });
    return out.slice(0, DISCOVERY_LIMITS.suggestMax);
  });
}
