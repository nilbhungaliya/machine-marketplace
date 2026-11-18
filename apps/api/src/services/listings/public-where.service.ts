import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { PUBLIC_LISTING_STATUSES } from '@mpm/shared-types';
import { listings } from '../../db/schema.js';

// The one definition of "public" (F2 spec §7.1, R20, R49): a listing is served to anyone only when its status is public
// (`live`, `reserved`, `rented`) **and** its business isn't restricted — no owner user (`member_role = 'owner'`) of the
// business is suspended or blocked. The status isn't changed by a suspension, so reinstating brings the listings back.
// `users_business_id_idx` keeps the EXISTS cheap.

/** Anything with the two listing columns the condition reads: `listings` itself or an `alias(listings, …)`. */
export interface ListingColumns {
  status: AnyColumn;
  businessId: AnyColumn;
}

const PUBLIC_STATUSES = sql.join(
  PUBLIC_LISTING_STATUSES.map((s) => sql`${s}`),
  sql`, `,
);

/** The SQL condition "this listing is public", for `listings` or an alias of it. */
export function publicListingWhere(t: ListingColumns = listings): SQL {
  return sql`(${t.status} IN (${PUBLIC_STATUSES}) AND NOT EXISTS (
    SELECT 1 FROM users ou
    WHERE ou.business_id = ${t.businessId} AND ou.member_role = 'owner' AND ou.status IN ('suspended', 'blocked')
  ))`;
}
