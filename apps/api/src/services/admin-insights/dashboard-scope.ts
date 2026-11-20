import { sql, type SQL } from 'drizzle-orm';
import type { AdminDashboardQuery } from '@mpm/shared-types';

// AD1 dashboard filters (admin close-out R2, plan A1-1). One rule per kind of row:
// - listing-side numbers (listings, enquiries, offers, deals, bookings, sold / closed) take city, industrial area and
//   machine category from the **listing**;
// - requirement numbers from the **request**;
// - business numbers from the **business** (category = the business's `categories` holds the machine category).
// City compares case-insensitively; machine category = the root of the row's category path
// (`c.path = root.path OR c.path` under `root.path || '/'`).

export interface DashboardScope {
  /** A boolean condition on a `listings` row aliased `alias`. */
  listing(alias: string): SQL;
  /** A boolean condition on a `part_requests` row aliased `alias`. */
  request(alias: string): SQL;
  /** A boolean condition on a `businesses` row aliased `alias`. */
  business(alias: string): SQL;
}

/** Filter values as SQL text expressions: a bound parameter, or a column of a breakdown group (`g.key`). */
export interface ScopeValues {
  city?: SQL;
  industrialAreaId?: SQL;
  categoryId?: SQL;
}

const TRUE = sql`TRUE`;

function all(parts: SQL[]): SQL {
  return parts.length ? sql.join(parts, sql` AND `) : TRUE;
}

/** The row's category (`alias.category_id`) is the machine category `root` or under it. */
function underRoot(alias: string, root: SQL): SQL {
  const a = sql.raw(alias);
  return sql`EXISTS (SELECT 1 FROM categories c JOIN categories root ON root.id = (${root})::uuid
    WHERE c.id = ${a}.category_id AND (c.path = root.path OR starts_with(c.path, root.path || '/')))`;
}

/** The place and category conditions of a listing or a part request (both carry city, area and category). */
function placeAndCategory(alias: string, v: ScopeValues): SQL {
  const a = sql.raw(alias);
  const parts: SQL[] = [];
  if (v.city) parts.push(sql`lower(${a}.city) = lower(${v.city})`);
  if (v.industrialAreaId) parts.push(sql`${a}.industrial_area_id = (${v.industrialAreaId})::uuid`);
  if (v.categoryId) parts.push(underRoot(alias, v.categoryId));
  return all(parts);
}

export function scopeOf(v: ScopeValues): DashboardScope {
  return {
    listing: (alias) => placeAndCategory(alias, v),
    request: (alias) => placeAndCategory(alias, v),
    business: (alias) => {
      const a = sql.raw(alias);
      const parts: SQL[] = [];
      if (v.city) parts.push(sql`lower(${a}.city) = lower(${v.city})`);
      if (v.industrialAreaId) parts.push(sql`${a}.industrial_area_id = (${v.industrialAreaId})::uuid`);
      if (v.categoryId) parts.push(sql`${a}.categories @> jsonb_build_array((${v.categoryId})::text)`);
      return all(parts);
    },
  };
}

/** Both scopes at once (a breakdown group inside the page's filters). */
export function bothScopes(x: DashboardScope, y: DashboardScope): DashboardScope {
  return {
    listing: (alias) => sql`(${x.listing(alias)}) AND (${y.listing(alias)})`,
    request: (alias) => sql`(${x.request(alias)}) AND (${y.request(alias)})`,
    business: (alias) => sql`(${x.business(alias)}) AND (${y.business(alias)})`,
  };
}

/** The page's filters (R2). An empty city is no filter. */
export function dashboardScope(q: Pick<AdminDashboardQuery, 'city' | 'industrialAreaId' | 'categoryId'>): DashboardScope {
  const city = q.city?.trim();
  return scopeOf({
    city: city ? sql`${city}::text` : undefined,
    industrialAreaId: q.industrialAreaId ? sql`${q.industrialAreaId}::text` : undefined,
    categoryId: q.categoryId ? sql`${q.categoryId}::text` : undefined,
  });
}
