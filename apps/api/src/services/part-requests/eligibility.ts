import { eq, getTableName, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../../db/index.js';
import { businesses, partRequests } from '../../db/schema.js';
import type { PartRequestColumns } from './locks.js';

// Who may see and reply to a request (spec §6, R6; textile `services/requirements/eligibility.ts`): one SQL predicate,
// computed on every read and action, never stored. The buyer business sees its own requests; anything else not
// eligible answers `404 PART_REQUEST_NOT_FOUND`, as a missing request. Distance is not part of eligibility.

type Conn = Db | Tx;

/** Owners of a business are restricted (suspended or blocked): the `publicListingWhere` sub-condition. */
const ownerRestricted = (businessId: SQL): SQL => sql`EXISTS (
  SELECT 1 FROM users ou
  WHERE ou.business_id = ${businessId} AND ou.member_role = 'owner' AND ou.status IN ('suspended', 'blocked')
)`;

/**
 * A column as `"table"."column"` (or `"alias"."column"`), built from names, never from the Column object. Drizzle
 * renders Column objects inside a raw `sql` **selection field** unqualified in a single-table select
 * (`db.select({ ok: sql… }).from(partRequests)`), and an unqualified `"id"` or `"category_id"` inside a subquery binds
 * to the subquery's own table. Use this for every outer-row column a correlated subquery reads.
 */
export function qualifiedSql(column: AnyColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}

/**
 * Business `sellerBusinessId` is eligible for request `r` (spec §6), all six conditions:
 * 1. S finished onboarding (`pincode IS NOT NULL`) and no owner of S is suspended or blocked;
 * 2. S is not `r`'s business, and no owner of the posting business is suspended or blocked;
 * 3. no `business_blocks` row either way;
 * 4. `r.audience = 'any_seller'` or S is GST-verified (`verification_levels ? 'gst'`);
 * 5. (`r`'s machine category is in `S.categories` **and** `'sell' = ANY(S.activities)`) **or** S has a live public
 *    listing whose category lies in `r.category_id`'s subtree (slug path prefix); "public" is `status = 'live'` plus
 *    condition 1's owner check (`publicListingWhere`'s two parts);
 * 6. `r.status = 'active'`, or S has a reply on `r` (it follows its reply's outcome, read only).
 *
 * `sellerBusinessId` is an id or a SQL expression (a column of an outer query, wrapped with `qualifiedSql`); `table`
 * is `partRequests` or an alias. Every column is written qualified (`qualifiedSql`), so the predicate is safe in a
 * single-table select.
 */
export function eligibleSellerSql(sellerBusinessId: string | SQL, table: PartRequestColumns = partRequests): SQL {
  const s: SQL = typeof sellerBusinessId === 'string' ? sql`${sellerBusinessId}::uuid` : sellerBusinessId;
  const r = {
    id: qualifiedSql(table.id),
    businessId: qualifiedSql(table.businessId),
    categoryId: qualifiedSql(table.categoryId),
    audience: qualifiedSql(table.audience),
    status: qualifiedSql(table.status),
  };
  return sql`(
    ${s} <> ${r.businessId}
    AND EXISTS (
      SELECT 1 FROM businesses es
      WHERE es.id = ${s}
        AND es.pincode IS NOT NULL
        AND NOT ${ownerRestricted(sql`es.id`)}
        AND (${r.audience} = 'any_seller' OR es.verification_levels ? 'gst')
        AND (
          EXISTS (
            SELECT 1 FROM categories erc
            JOIN categories eroot ON eroot.level = 'machine_category'
              AND (erc.path = eroot.path OR erc.path LIKE eroot.path || '/%')
            WHERE erc.id = ${r.categoryId}
              AND es.categories @> jsonb_build_array(eroot.id::text)
              AND 'sell' = ANY(es.activities)
          )
          OR EXISTS (
            SELECT 1 FROM categories erc2, listings el
            JOIN categories elc ON elc.id = el.category_id
            WHERE erc2.id = ${r.categoryId}
              AND el.business_id = es.id
              AND el.status = 'live'
              AND (elc.path = erc2.path OR elc.path LIKE erc2.path || '/%')
          )
        )
    )
    AND NOT ${ownerRestricted(sql`${r.businessId}`)}
    AND NOT EXISTS (
      SELECT 1 FROM business_blocks ebb
      WHERE (ebb.blocker_business_id = ${s} AND ebb.blocked_business_id = ${r.businessId})
         OR (ebb.blocker_business_id = ${r.businessId} AND ebb.blocked_business_id = ${s})
    )
    AND (
      ${r.status} = 'active'
      OR EXISTS (SELECT 1 FROM part_request_replies epr WHERE epr.part_request_id = ${r.id} AND epr.seller_business_id = ${s})
    )
  )`;
}

/** Whether the business may see and reply to the request now (§6). False for a missing request. */
export async function isEligibleSeller(conn: Conn, requestId: string, sellerBusinessId: string): Promise<boolean> {
  const [row] = await conn
    .select({ ok: eligibleSellerSql(sellerBusinessId) })
    .from(partRequests)
    .where(eq(partRequests.id, requestId));
  return row?.ok === true;
}

/** How many businesses are eligible for the request now (admin "eligible now", §14). */
export async function eligibleSellerCount(conn: Conn, requestId: string): Promise<number> {
  const s = alias(businesses, 'ecs');
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(partRequests)
    .innerJoin(s, eligibleSellerSql(qualifiedSql(s.id)))
    .where(eq(partRequests.id, requestId));
  return Number(row?.n ?? 0);
}

/** The reader's role on a request: its own business's (`buyer`), an eligible seller (`seller`), else null (404). */
export async function requestRoleFor(conn: Conn, requestId: string, businessId: string): Promise<'buyer' | 'seller' | null> {
  const [row] = await conn
    .select({ own: sql<boolean>`${qualifiedSql(partRequests.businessId)} = ${businessId}::uuid`, eligible: eligibleSellerSql(businessId) })
    .from(partRequests)
    .where(eq(partRequests.id, requestId));
  if (!row) return null;
  if (row.own) return 'buyer';
  return row.eligible ? 'seller' : null;
}
