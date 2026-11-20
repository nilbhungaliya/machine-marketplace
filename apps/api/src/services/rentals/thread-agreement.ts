import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/index.js';

export type ThreadAgreement = { kind: 'deal'; id: string } | { kind: 'rental'; id: string };

/**
 * What a thread's reveal hangs on (M14 spec §8, R9): the newest of the thread's deals (any status: F6's
 * `latestDealId`, by `accepted_at`) and its rental bookings that were ever confirmed (`confirmed_at` set: the reveal is
 * permanent, so a later cancel or completion keeps it), by that time. Null when the thread has neither (an open request
 * alone reveals nothing). A1-5 switches the consent service (`maybeReveal`, `contactState`, `shareContact`) to it.
 */
export async function threadAgreement(conn: Db | Tx, threadId: string): Promise<ThreadAgreement | null> {
  const { rows } = await conn.execute<{ kind: 'deal' | 'rental'; id: string }>(sql`
    SELECT kind, id FROM (
      SELECT 'deal' AS kind, d.id::text AS id, d.accepted_at AS at FROM deals d WHERE d.thread_id = ${threadId}
      UNION ALL
      SELECT 'rental' AS kind, b.id::text AS id, b.confirmed_at AS at
      FROM rental_bookings b WHERE b.thread_id = ${threadId} AND b.confirmed_at IS NOT NULL
    ) a
    ORDER BY a.at DESC, a.id DESC
    LIMIT 1
  `);
  const row = rows[0];
  return row ? { kind: row.kind, id: row.id } : null;
}
