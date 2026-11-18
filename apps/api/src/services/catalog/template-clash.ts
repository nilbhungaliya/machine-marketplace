import { inArray, sql } from 'drizzle-orm';
import type { CatalogStatus, FieldAppliesTo } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { categories, templateFields } from '../../db/schema.js';
import { ConflictError } from '../../lib/errors.js';

// A field `key` (any status, any appliesTo) is unique across every effective template it takes part in. An active
// `highlightRank` is unique among active fields of one effective template whose `appliesTo` overlap. Shared by field
// writes (Task 7) and node moves (Task 6).

/** `both` overlaps everything; `parts` and `machines` don't overlap each other. */
export function appliesToOverlap(a: FieldAppliesTo, b: FieldAppliesTo): boolean {
  return a === 'both' || b === 'both' || a === b;
}

/**
 * The node, its ancestors and its descendants: every node whose fields share an effective template with a field on this
 * node. Siblings (and their subtrees) are not included. `path` must be read after `lockCatalogRoots`.
 */
export async function templateRelatedIds(db: Db | Tx, path: string): Promise<string[]> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      sql`${categories.path} = ${path}::text
        OR starts_with(${categories.path}, ${path}::text || '/')
        OR starts_with(${path}::text, ${categories.path} || '/')`,
    );
  return rows.map((r) => r.id);
}

/** What a field claims in a template. `id` is set for an existing field, so it never clashes with itself. */
export interface FieldClaim {
  id?: string;
  key: string;
  status: CatalogStatus;
  appliesTo: FieldAppliesTo;
  highlightRank: number | null;
}

type ClashRow = { id: string; key: string; status: CatalogStatus; appliesTo: FieldAppliesTo; highlightRank: number | null };

function hasActiveRank(f: { status: CatalogStatus; highlightRank: number | null }): boolean {
  return f.status === 'active' && f.highlightRank !== null;
}

function loadFields(db: Db | Tx, categoryIds: string[]): Promise<ClashRow[]> {
  if (categoryIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: templateFields.id,
      key: templateFields.key,
      status: templateFields.status,
      appliesTo: templateFields.appliesTo,
      highlightRank: templateFields.highlightRank,
    })
    .from(templateFields)
    .where(inArray(templateFields.categoryId, categoryIds));
}

type Clash = { code: 'KEY_TAKEN' | 'RANK_TAKEN'; key: string; rank?: number };

function keyClash(a: { key: string }, b: { key: string }): Clash | null {
  return a.key === b.key ? { code: 'KEY_TAKEN', key: a.key } : null;
}

/** Same active rank with overlapping appliesTo. */
function rankClash(a: ClashRow | FieldClaim, b: ClashRow | FieldClaim): Clash | null {
  return hasActiveRank(a) && hasActiveRank(b) && a.highlightRank === b.highlightRank && appliesToOverlap(a.appliesTo, b.appliesTo)
    ? { code: 'RANK_TAKEN', key: a.key, rank: a.highlightRank! }
    : null;
}

function throwClash(c: Clash): never {
  throw c.code === 'KEY_TAKEN'
    ? new ConflictError(`The key "${c.key}" is already used in a template this field belongs to`, 'KEY_TAKEN')
    : new ConflictError(`Highlight rank ${c.rank} is already used in a template this field belongs to`, 'RANK_TAKEN');
}

/**
 * Throws `KEY_TAKEN` if a field key (any status) on `ancestorIds` also exists on `subtreeIds`, `RANK_TAKEN` if an active
 * field on one and an active field on the other share a `highlightRank` and their `appliesTo` overlap. Keys win over ranks.
 * `ancestorIds` are the nodes above the subtree's top node (the destination's chain); `subtreeIds` is the moved node and
 * all its descendants. Call after `lockCatalogRoots`.
 */
export async function assertNoClash(tx: Tx, params: { ancestorIds: string[]; subtreeIds: string[] }): Promise<void> {
  const [ancestorFields, subtreeFields] = await Promise.all([loadFields(tx, params.ancestorIds), loadFields(tx, params.subtreeIds)]);
  let rank: Clash | null = null;
  for (const a of ancestorFields) {
    for (const s of subtreeFields) {
      const k = keyClash(a, s);
      if (k) throwClash(k);
      rank ??= rankClash(a, s);
    }
  }
  if (rank) throwClash(rank);
}

/**
 * Throws `KEY_TAKEN` / `RANK_TAKEN` when the claim clashes with a field of `relatedIds` (the node, its ancestors and its
 * descendants: every node whose fields share an effective template with the claim). Other fields are compared by id, so a
 * claim never clashes with the stored version of itself. Call after `lockCatalogRoots`.
 */
export async function assertClaimFree(
  tx: Tx,
  relatedIds: string[],
  claim: FieldClaim,
  check: { key: boolean } = { key: true },
): Promise<void> {
  const existing = (await loadFields(tx, relatedIds)).filter((f) => f.id !== claim.id);
  let rank: Clash | null = null;
  for (const f of existing) {
    const k = check.key ? keyClash(claim, f) : null;
    if (k) throwClash(k);
    rank ??= rankClash(claim, f);
  }
  if (rank) throwClash(rank);
}
