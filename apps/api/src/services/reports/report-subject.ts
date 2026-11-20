import { sql, type SQL } from 'drizzle-orm';

const ALIAS = /^[a-z_][a-z0-9_]*$/i;

/**
 * The business a report is against (admin close-out §7, plan C0-4), as a uuid SQL expression over a `reports` row
 * aliased `alias`: `business` → the target itself; `listing` → the listing's business; `part_request` → the request's
 * business; `review` → the business that wrote the review; `conversation` → the thread's party that is **not** the
 * reporter's business (null when the reporter is neither party); `user` → null. Used by the business detail's
 * Reports (n), the `reports_against` fraud rule and the Reports queue.
 */
export function reportAgainstSql(alias = 'r'): SQL {
  if (!ALIAS.test(alias)) throw new Error(`reportAgainstSql: bad alias "${alias}"`);
  const r = sql.raw(alias);
  return sql`(CASE ${r}.target_type
    WHEN 'business' THEN ${r}.target_id
    WHEN 'listing' THEN (SELECT rs_l.business_id FROM listings rs_l WHERE rs_l.id = ${r}.target_id)
    WHEN 'part_request' THEN (SELECT rs_pr.business_id FROM part_requests rs_pr WHERE rs_pr.id = ${r}.target_id)
    WHEN 'review' THEN (SELECT rs_rv.reviewer_business_id FROM deal_reviews rs_rv WHERE rs_rv.id = ${r}.target_id)
    WHEN 'conversation' THEN (
      SELECT CASE
        WHEN rs_t.buyer_business_id = ${r}.reporter_business_id THEN rs_t.seller_business_id
        WHEN rs_t.seller_business_id = ${r}.reporter_business_id THEN rs_t.buyer_business_id
      END
      FROM chat_threads rs_t WHERE rs_t.id = ${r}.target_id)
    ELSE NULL::uuid
  END)`;
}
