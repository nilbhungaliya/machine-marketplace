import { sql, type SQL } from 'drizzle-orm';
import type { TxApp } from '../../lib/tx-effects.js';

/**
 * The `admin-retention` job (admin close-out §9, §16): deletes sightings older than 90 days, signals closed more than a
 * year ago and password tokens used or expired more than 7 days ago, in batches of 1 000 (`FOR UPDATE SKIP LOCKED`, so
 * it never waits on a row another writer holds; a skipped row goes next day).
 */

const BATCH = 1_000;
/** A safety stop per table and run (10 million rows); the next day's run carries on. */
const MAX_BATCHES = 10_000;

const DELETES: { name: string; sql: SQL }[] = [
  {
    name: 'install_sightings',
    sql: sql`DELETE FROM install_sightings WHERE (install_hash, user_id) IN (
      SELECT install_hash, user_id FROM install_sightings
       WHERE last_seen_at < now() - interval '90 days'
       LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)`,
  },
  {
    name: 'fraud_signals',
    sql: sql`DELETE FROM fraud_signals WHERE id IN (
      SELECT id FROM fraud_signals
       WHERE status IN ('dismissed', 'actioned') AND reviewed_at < now() - interval '1 year'
       LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)`,
  },
  {
    name: 'admin_password_tokens',
    sql: sql`DELETE FROM admin_password_tokens WHERE id IN (
      SELECT id FROM admin_password_tokens
       WHERE used_at < now() - interval '7 days' OR expires_at < now() - interval '7 days'
       LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)`,
  },
];

/**
 * Contact sightings by `id` ranges: the run first finds the highest old `id` once, then each batch walks the primary key
 * up to it (ids grow with the scan, so old rows sit at the low end) instead of scanning the table per batch.
 */
async function contactSightingDeletes(app: TxApp): Promise<SQL | null> {
  const { rows } = await app.db.execute<{ bound: string | null }>(
    sql`SELECT max(id)::text AS bound FROM contact_sightings WHERE seen_at < now() - interval '90 days'`,
  );
  const bound = rows[0]?.bound;
  if (!bound) return null;
  return sql`DELETE FROM contact_sightings WHERE id IN (
    SELECT id FROM contact_sightings
     WHERE id <= ${bound}::bigint AND seen_at < now() - interval '90 days'
     ORDER BY id
     LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)`;
}

export async function runAdminRetention(app: TxApp): Promise<void> {
  const contacts = await contactSightingDeletes(app);
  const deletes = contacts ? [...DELETES, { name: 'contact_sightings', sql: contacts }] : DELETES;
  for (const d of deletes) {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const res = await app.db.execute(d.sql);
      const n = res.rowCount ?? 0;
      total += n;
      if (n < BATCH) break;
    }
    if (total > 0) app.log.info({ table: d.name, deleted: total }, 'admin-retention: deleted');
  }
}
