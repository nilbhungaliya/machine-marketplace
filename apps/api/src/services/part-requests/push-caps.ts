import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { IST_TODAY } from '../../lib/ist.js';

// The per-seller daily push cap for `part_request_new` (spec §7.5, §5.8): one atomic upsert per targeting pass, never a
// business row lock.

/** Today in India (IST), as a SQL date: the shared helper (M14 plan D11), re-exported for F8's callers. */
export { IST_TODAY };

/**
 * Counts one push for each business still under `cap` today (IST) and returns those businesses: they get a push, the
 * others an in-app row only. Cap 0 → nobody, and nothing is written (the INSERT branch would count a first push). The
 * ids are sorted, so two passes upserting the same businesses take the row locks in one order (no deadlock); the
 * `WHERE pushes < cap` of `DO UPDATE` is re-checked after a concurrent pass commits, so the cap holds across processes.
 */
export async function allowSellerPushes(tx: Tx, businessIds: string[], cap: number): Promise<Set<string>> {
  const ids = [...new Set(businessIds)].sort();
  if (cap <= 0 || ids.length === 0) return new Set();
  const values = sql.join(
    ids.map((id) => sql`(${id}::uuid, ${IST_TODAY}, 1)`),
    sql`, `,
  );
  const { rows } = await tx.execute<{ business_id: string }>(sql`
    INSERT INTO part_request_push_counts (business_id, day, pushes) VALUES ${values}
    ON CONFLICT (business_id, day) DO UPDATE SET pushes = part_request_push_counts.pushes + 1
    WHERE part_request_push_counts.pushes < ${cap}::int
    RETURNING business_id`);
  return new Set(rows.map((r) => r.business_id));
}
