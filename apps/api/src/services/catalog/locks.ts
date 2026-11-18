import { asc, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { categories } from '../../db/schema.js';

/** Ids of the root machine categories the given nodes belong to (a root belongs to itself). Unknown ids are ignored. */
async function rootIdsOf(tx: Tx, nodeIds: string[]): Promise<string[]> {
  const list = sql.join(nodeIds.map((id) => sql`${id}::uuid`), sql`, `);
  const result = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id FROM categories WHERE id IN (${list})
      UNION ALL
      SELECT c.id, c.parent_id FROM categories c JOIN up ON c.id = up.parent_id
    )
    SELECT DISTINCT id FROM up WHERE parent_id IS NULL
  `);
  return result.rows.map((r) => r.id);
}

/**
 * Locks (`SELECT … FOR UPDATE`) the root machine category of every given node for the rest of the transaction, so two
 * admins changing the same category's tree or templates (moves, renames, field writes) run one after the other and the
 * clash checks that follow see each other's changes. Roots are locked in ascending id order, so two moves that touch the
 * same pair of roots can't deadlock.
 *
 * A machine type can move to another root while we wait for its lock, so the roots are resolved again once locked; a
 * root that turns up then is locked too (after the ones we hold, which is the only case that can leave the id order).
 * Callers read nodes only after this returns.
 */
export async function lockCatalogRoots(tx: Tx, nodeIds: string[]): Promise<void> {
  const ids = [...new Set(nodeIds)];
  if (ids.length === 0) return;
  const locked = new Set<string>();
  for (;;) {
    const wanted = (await rootIdsOf(tx, ids)).filter((id) => !locked.has(id));
    if (wanted.length === 0) return;
    const rows = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, wanted))
      .orderBy(asc(categories.id))
      .for('update');
    for (const r of rows) locked.add(r.id);
    // A wanted root that no longer exists can't be locked; stop rather than spin.
    if (rows.length === 0) return;
  }
}
