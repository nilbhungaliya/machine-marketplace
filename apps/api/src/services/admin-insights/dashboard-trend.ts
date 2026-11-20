import { sql, type SQL } from 'drizzle-orm';
import type { AdminDashboard, AdminDashboardQuery, DashboardBreakdown } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { addDays } from '../../lib/ist.js';
import { bothScopes, dashboardScope, scopeOf, type DashboardScope } from './dashboard-scope.js';
import { periodColumns, snapshotSql } from './dashboard.js';
import { periodWindows, type DashboardPeriod, type Window } from './period.js';

// AD1 dashboard trend and breakdown (admin close-out §6.1 sections 5–6, R3; plan A1-2). Both call the period builders
// of `dashboard.ts`, so their sums equal the tiles (review focus 5).

type Conn = Db | Tx;

const TREND_KEYS = ['enquiries', 'offers', 'deals', 'dealValuePaise', 'rentalBookings'] as const;

/**
 * One point per IST day (`granularity` day) or per Monday week, every bucket present even when zero. A week is
 * labelled by its Monday (the first may start before `from`); its counts are clamped to `[from, to]`, so the buckets
 * add up to the period's tiles.
 */
export async function dashboardTrend(
  conn: Conn,
  q: Pick<AdminDashboardQuery, 'city' | 'industrialAreaId' | 'categoryId'>,
  period: DashboardPeriod,
): Promise<AdminDashboard['trend']> {
  const s = dashboardScope(q);
  const weekly = period.granularity === 'week';
  const step = weekly ? sql`interval '7 days'` : sql`interval '1 day'`;
  const first = weekly ? sql`date_trunc('week', (${period.from}::date)::timestamp)` : sql`(${period.from}::date)::timestamp`;
  const end = addDays(period.to, 1);
  const w: Window = {
    start: sql`(GREATEST(g.d, ${period.from}::date)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
    end: sql`(LEAST((g.d + ${step})::date, ${end}::date)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
  };
  const { rows } = await conn.execute<Record<string, unknown> & { bucket: string }>(sql`
    SELECT to_char(g.d, 'YYYY-MM-DD') AS bucket, m.*
    FROM generate_series(${first}, (${period.to}::date)::timestamp, ${step}) AS gs(t)
    CROSS JOIN LATERAL (SELECT gs.t::date AS d) g
    CROSS JOIN LATERAL (SELECT ${periodColumns(TREND_KEYS, s, w)}) m
    ORDER BY g.d
  `);
  return rows.map((r) => ({
    bucket: r.bucket,
    enquiries: Number(r.enquiries ?? 0),
    offers: Number(r.offers ?? 0),
    deals: Number(r.deals ?? 0),
    dealValuePaise: Number(r.dealValuePaise ?? 0),
    rentalBookings: Number(r.rentalBookings ?? 0),
  }));
}

export const BREAKDOWN_ROWS = 10;

const ACTIVE_LISTING = sql`l.status IN ('live', 'reserved', 'rented')`;

/** The top groups by active listings (within the page's filters) and the scope of one group, `g.key`. */
function groupsOf(by: DashboardBreakdown, s: DashboardScope): { select: SQL; group: DashboardScope } {
  switch (by) {
    case 'city':
      return {
        select: sql`SELECT lower(l.city) AS key, min(l.city) AS label, count(*)::int AS n FROM listings l
          WHERE ${ACTIVE_LISTING} AND btrim(COALESCE(l.city, '')) <> '' AND ${s.listing('l')}
          GROUP BY lower(l.city)`,
        group: scopeOf({ city: sql`g.key` }),
      };
    case 'industrial_area':
      return {
        select: sql`SELECT ia.id::text AS key, ia.name AS label, count(*)::int AS n FROM listings l
          JOIN industrial_areas ia ON ia.id = l.industrial_area_id
          WHERE ${ACTIVE_LISTING} AND ${s.listing('l')}
          GROUP BY ia.id, ia.name`,
        group: scopeOf({ industrialAreaId: sql`g.key` }),
      };
    case 'category':
      return {
        select: sql`SELECT root.id::text AS key, root.name AS label, count(*)::int AS n FROM listings l
          JOIN categories c ON c.id = l.category_id
          JOIN categories root ON root.parent_id IS NULL AND (c.path = root.path OR starts_with(c.path, root.path || '/'))
          WHERE ${ACTIVE_LISTING} AND ${s.listing('l')}
          GROUP BY root.id, root.name`,
        group: scopeOf({ categoryId: sql`g.key` }),
      };
  }
}

/**
 * The breakdown table (§6.1 section 6, plan D6): the top 10 cities / industrial areas / machine categories by active
 * listings within the page's filters; each row's numbers are the tiles' builders with the group added to the filters.
 */
export async function dashboardBreakdown(
  conn: Conn,
  q: Pick<AdminDashboardQuery, 'city' | 'industrialAreaId' | 'categoryId'>,
  period: DashboardPeriod,
  by: DashboardBreakdown,
): Promise<AdminDashboard['breakdown']['rows']> {
  const s = dashboardScope(q);
  const { select, group } = groupsOf(by, s);
  const { rows: groups } = await conn.execute<{ key: string; label: string; n: number }>(
    sql`SELECT x.key, x.label, x.n FROM (${select}) x ORDER BY x.n DESC, x.label, x.key LIMIT ${BREAKDOWN_ROWS}`,
  );
  if (groups.length === 0) return [];

  const gs = bothScopes(s, group);
  const w = periodWindows(period);
  const values = sql.join(
    groups.map((g, i) => sql`(${g.key}::text, ${i}::int)`),
    sql`, `,
  );
  const { rows } = await conn.execute<Record<string, unknown> & { key: string }>(sql`
    SELECT g.key,
      ${snapshotSql.activeListings(gs)} AS "activeListings",
      ${periodColumns(['newListings', 'enquiries', 'deals', 'dealValuePaise'], gs, w.current)},
      ${periodColumns(['deals'], gs, w.previous, 'Previous')}
    FROM (VALUES ${values}) AS g(key, ord)
    ORDER BY g.ord
  `);
  return rows.map((r, i) => ({
    key: r.key,
    label: groups[i]!.label,
    activeListings: Number(r.activeListings ?? 0),
    newListings: Number(r.newListings ?? 0),
    enquiries: Number(r.enquiries ?? 0),
    deals: Number(r.deals ?? 0),
    dealValuePaise: Number(r.dealValuePaise ?? 0),
    dealsPrevious: Number(r.dealsPrevious ?? 0),
  }));
}
