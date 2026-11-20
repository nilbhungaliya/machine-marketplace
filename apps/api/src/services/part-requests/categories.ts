import { sql, type SQL } from 'drizzle-orm';
import type { CatalogLevel, PartRequestKind } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { loadNode } from '../listings/listing-validate.service.js';

// Category helpers for F8 (spec §5.1, §6). `categories.path` holds slugs (`textile/embroidery/needles`), so a subtree
// is matched by path prefix, as `discovery/filters.ts` does, never by id arithmetic. Nothing here is stored: the
// machine category (root) of a request is resolved from paths on every read, so catalogue moves can't stale it.

type Conn = Db | Tx;

/**
 * "`node` lies in `root`'s subtree (or is it)": `node.path = root.path OR node.path LIKE root.path || '/%'`. Both are
 * SQL references to a `categories` row (an alias such as sql`lc`, or a table expression).
 */
export function subtreeSql(node: SQL, root: SQL): SQL {
  return sql`(${node}.path = ${root}.path OR ${node}.path LIKE ${root}.path || '/%')`;
}

/** Ids of every node on the category's path, the node included (root first). Empty for an unknown id. */
export async function categoryAncestorIds(conn: Conn, categoryId: string): Promise<string[]> {
  const { rows } = await conn.execute<{ id: string }>(sql`
    SELECT a.id FROM categories c
    JOIN categories a ON (c.path = a.path OR c.path LIKE a.path || '/%')
    WHERE c.id = ${categoryId}
    ORDER BY length(a.path)`);
  return rows.map((r) => r.id);
}

/** The machine category (root) above a node, or the node itself when it is one; null for an unknown id. */
export async function machineCategoryOf(conn: Conn, categoryId: string): Promise<{ id: string; path: string } | null> {
  const { rows } = await conn.execute<{ id: string; path: string }>(sql`
    SELECT root.id, root.path FROM categories c
    JOIN categories root ON root.level = 'machine_category' AND (c.path = root.path OR c.path LIKE root.path || '/%')
    WHERE c.id = ${categoryId}
    LIMIT 1`);
  return rows[0] ?? null;
}

/**
 * The node a request of `kind` may sit on (§5.1): parts a part group or a machine type, machines a machine type; the
 * whole chain active. `hasSides` is the node's effective side setting (inherited). Null otherwise (the caller answers
 * `400 CATEGORY_INVALID`).
 */
export async function requestCategoryNode(
  conn: Conn,
  categoryId: string,
  kind: PartRequestKind,
): Promise<{ id: string; level: CatalogLevel; path: string; hasSides: boolean } | null> {
  const node = await loadNode(conn, categoryId);
  if (!node || !node.chainActive) return null;
  const allowed: CatalogLevel[] = kind === 'part' ? ['part_group', 'machine_type'] : ['machine_type'];
  if (!allowed.includes(node.level)) return null;
  const { rows } = await conn.execute<{ path: string }>(sql`SELECT path FROM categories WHERE id = ${categoryId}`);
  if (!rows[0]) return null;
  return { id: node.id, level: node.level, path: rows[0].path, hasSides: node.effectiveHasSides };
}
