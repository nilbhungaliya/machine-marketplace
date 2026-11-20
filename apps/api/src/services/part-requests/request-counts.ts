import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/index.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { eligibleSellerSql } from './eligibility.js';

// Counts for badges (spec §12.4, plan A1-4). Lane A1 owns this file.

/**
 * "Requests for you" (`GET /users/me/badges`): active requests the user's business is targeted by, still eligible
 * for (§6), hasn't opened (`opened_at`), replied to or marked Not relevant.
 */
export async function requestsForYouCount(conn: Db | Tx, user: UserTokenPayload): Promise<number> {
  const businessId = user.businessId;
  if (!businessId) return 0;
  const { rows } = await conn.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
      FROM part_request_targets t
      JOIN part_requests ON part_requests.id = t.part_request_id
     WHERE t.business_id = ${businessId}
       AND t.opened_at IS NULL
       AND part_requests.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM part_request_replies rr WHERE rr.part_request_id = t.part_request_id AND rr.seller_business_id = t.business_id)
       AND NOT EXISTS (SELECT 1 FROM part_request_feedback f WHERE f.part_request_id = t.part_request_id AND f.business_id = t.business_id)
       AND ${eligibleSellerSql(businessId)}`);
  return Number(rows[0]?.n ?? 0);
}
