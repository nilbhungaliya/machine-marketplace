import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { AdminDashboard, AdminDashboardQuery, PeriodCount, PeriodRate } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { discoveryRedisPrefix } from '../../env.js';
import { IST_TODAY, istToday } from '../../lib/ist.js';
import { dashboardScope, type DashboardScope } from './dashboard-scope.js';
import { dashboardBreakdown, dashboardTrend } from './dashboard-trend.js';
import { periodWindows, resolveDashboardPeriod, type DashboardPeriod, type Window } from './period.js';

/**
 * AD1 dashboard (admin close-out §6, R1–R4; plan A1-1, A1-2; textile `admin-insights/dashboard.ts`). Read-only, on the
 * database clock, IST days. **One SQL builder per metric (§6.2)**: the period tiles, the previous period, the trend
 * buckets and the breakdown rows all call the same builder with a different window or scope, so a number can't have
 * two definitions. Every builder takes the scope (`dashboard-scope.ts`, R2) and returns a scalar subquery.
 */

type Conn = Db | Tx;

const ACTIVE_LISTING = sql`('live', 'reserved', 'rented')`;

/** A row of `alias` with `column` inside the window. */
function inWindow(alias: string, column: string, w: Window): SQL {
  const c = sql.raw(`${alias}.${column}`);
  return sql`${c} >= ${w.start} AND ${c} < ${w.end}`;
}

/** Businesses with a trade name (an onboarded profile). */
const HAS_TRADE_NAME = (alias: string): SQL => sql`btrim(${sql.raw(alias)}.trade_name) <> ''`;

/** §6.2 "Businesses": a trade name and an `active` owner. */
function countedBusiness(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`${HAS_TRADE_NAME(alias)} AND EXISTS (
    SELECT 1 FROM users o WHERE o.business_id = ${a}.id AND o.member_role = 'owner' AND o.status = 'active')`;
}

// ─── Snapshot builders ("Right now": the place / category filters apply, the date range doesn't) ───

export const snapshotSql = {
  businesses: (s: DashboardScope) =>
    sql`(SELECT count(*) FROM businesses b WHERE ${countedBusiness('b')} AND ${s.business('b')})::int`,
  verifiedBusinesses: (s: DashboardScope) =>
    sql`(SELECT count(*) FROM businesses b WHERE ${countedBusiness('b')} AND b.verification_levels @> '["gst"]'::jsonb
      AND ${s.business('b')})::int`,
  /** Active users of the counted businesses. */
  activeUsers: (s: DashboardScope) =>
    sql`(SELECT count(*) FROM users u JOIN businesses b ON b.id = u.business_id
      WHERE u.status = 'active' AND ${countedBusiness('b')} AND ${s.business('b')})::int`,
  activeListings: (s: DashboardScope) =>
    sql`(SELECT count(*) FROM listings l WHERE l.status IN ${ACTIVE_LISTING} AND ${s.listing('l')})::int`,
  partsAvailable: (s: DashboardScope) =>
    sql`(SELECT count(*) FROM listings l WHERE l.kind = 'part' AND l.status = 'live'
      AND COALESCE(l.quantity, 0) - l.held_quantity > 0 AND ${s.listing('l')})::int`,
  machinesForRent: (s: DashboardScope) =>
    sql`(SELECT count(*) FROM listings l WHERE l.kind = 'machine_rental' AND l.status IN ('live', 'rented')
      AND ${s.listing('l')})::int`,
  /**
   * Σ machines over bookings `on_rent` (or `disputed` from `on_rent`) whose counted span covers IST today (M14 §5.7,
   * `rentals/capacity.ts`): from the earlier of the start and the on-site day to the later of the end and today. Never
   * a count of `rented` listings (§6.2, my call 29).
   */
  machinesOutToday: (s: DashboardScope) =>
    sql`(SELECT COALESCE(sum(rb.machines), 0) FROM rental_bookings rb JOIN listings l ON l.id = rb.listing_id
      WHERE (rb.status = 'on_rent' OR (rb.status = 'disputed' AND rb.disputed_from = 'on_rent'))
        AND LEAST(rb.start_date, COALESCE((rb.on_site_at AT TIME ZONE 'Asia/Kolkata')::date, rb.start_date)) <= ${IST_TODAY}
        AND GREATEST(rb.end_date, ${IST_TODAY}) >= ${IST_TODAY}
        AND ${s.listing('l')})::int`,
  openRequirements: (s: DashboardScope) =>
    sql`(SELECT count(*) FROM part_requests r WHERE r.status = 'active' AND ${s.request('r')})::int`,
};

// ─── Period builders (one per §6.2 metric; money as text: `bigint` sums) ───

export const periodSql = {
  newBusinesses: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(*) FROM businesses b WHERE ${HAS_TRADE_NAME('b')} AND ${inWindow('b', 'created_at', w)}
      AND ${s.business('b')})::int`,
  /** Threads created in the window (a thread opened by a booking request counts, my call 4). */
  enquiries: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(*) FROM chat_threads t JOIN listings l ON l.id = t.listing_id
      WHERE ${inWindow('t', 'created_at', w)} AND ${s.listing('l')})::int`,
  /** First offers (`round = 0`, buy-at-price included). */
  offers: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(*) FROM offers o JOIN listings l ON l.id = o.listing_id
      WHERE o.round = 0 AND ${inWindow('o', 'created_at', w)} AND ${s.listing('l')})::int`,
  deals: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(*) FROM deals d JOIN listings l ON l.id = d.listing_id
      WHERE ${inWindow('d', 'accepted_at', w)} AND ${s.listing('l')})::int`,
  /** Agreed value of the window's deals that aren't cancelled. */
  dealValuePaise: (s: DashboardScope, w: Window) =>
    sql`(SELECT COALESCE(sum(d.total_paise), 0) FROM deals d JOIN listings l ON l.id = d.listing_id
      WHERE d.status <> 'cancelled' AND ${inWindow('d', 'accepted_at', w)} AND ${s.listing('l')})::text`,
  dealsCompleted: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(*) FROM deals d JOIN listings l ON l.id = d.listing_id
      WHERE ${inWindow('d', 'completed_at', w)} AND ${s.listing('l')})::int`,
  /** Bookings confirmed in the window, attributed to the listing (the machine's base), not the site (my call 3). */
  rentalBookings: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(*) FROM rental_bookings rb JOIN listings l ON l.id = rb.listing_id
      WHERE ${inWindow('rb', 'confirmed_at', w)} AND ${s.listing('l')})::int`,
  rentalValuePaise: (s: DashboardScope, w: Window) =>
    sql`(SELECT COALESCE(sum(rb.agreed_total_paise), 0) FROM rental_bookings rb JOIN listings l ON l.id = rb.listing_id
      WHERE rb.status <> 'cancelled' AND ${inWindow('rb', 'confirmed_at', w)} AND ${s.listing('l')})::text`,
  /** Distinct listings moved to `sold` in the window. */
  soldListings: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(DISTINCT h.listing_id) FROM listing_status_history h JOIN listings l ON l.id = h.listing_id
      WHERE h.to_status = 'sold' AND ${inWindow('h', 'created_at', w)} AND ${s.listing('l')})::int`,
  /** Distinct listings moved to `unavailable` in the window. */
  closedListings: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(DISTINCT h.listing_id) FROM listing_status_history h JOIN listings l ON l.id = h.listing_id
      WHERE h.to_status = 'unavailable' AND ${inWindow('h', 'created_at', w)} AND ${s.listing('l')})::int`,
  /** Listings live for the first time in the window (the breakdown's "new listings"). */
  newListings: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(*) FROM listings l WHERE ${inWindow('l', 'first_live_at', w)} AND ${s.listing('l')})::int`,
  requirementsPosted: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(*) FROM part_requests r WHERE ${inWindow('r', 'first_posted_at', w)} AND ${s.request('r')})::int`,
  /** Of those posted in the window: with a delivered reply or a match (the match rate's numerator). */
  requirementsMatched: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(*) FROM part_requests r WHERE ${inWindow('r', 'first_posted_at', w)} AND ${s.request('r')}
      AND (EXISTS (SELECT 1 FROM part_request_replies pr WHERE pr.part_request_id = r.id AND pr.status = 'delivered')
        OR EXISTS (SELECT 1 FROM part_request_matches pm WHERE pm.part_request_id = r.id)))::int`,
  /** Median hours from first post to fulfilment, requests fulfilled in the window. */
  fulfilmentMedianHours: (s: DashboardScope, w: Window) =>
    sql`(SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (extract(epoch FROM r.fulfilled_at - r.first_posted_at) / 3600)::float8)
      FROM part_requests r WHERE ${inWindow('r', 'fulfilled_at', w)} AND ${s.request('r')})::float8`,
  /** Threads created in the window and at least 24 h old: the reply rate's denominator. */
  replyMeasured: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(*) FROM chat_threads t JOIN listings l ON l.id = t.listing_id
      WHERE ${inWindow('t', 'created_at', w)} AND t.created_at <= now() - interval '24 hours' AND ${s.listing('l')})::int`,
  replyAnswered24h: (s: DashboardScope, w: Window) =>
    sql`(SELECT count(*) FROM chat_threads t JOIN listings l ON l.id = t.listing_id
      WHERE ${inWindow('t', 'created_at', w)} AND t.created_at <= now() - interval '24 hours' AND ${s.listing('l')}
        AND t.first_seller_reply_at <= t.created_at + interval '24 hours')::int`,
  /** Median hours to the seller's first reply over the measured threads that have one. */
  firstReplyMedianHours: (s: DashboardScope, w: Window) =>
    sql`(SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (extract(epoch FROM t.first_seller_reply_at - t.created_at) / 3600)::float8)
      FROM chat_threads t JOIN listings l ON l.id = t.listing_id
      WHERE ${inWindow('t', 'created_at', w)} AND t.created_at <= now() - interval '24 hours' AND ${s.listing('l')}
        AND t.first_seller_reply_at IS NOT NULL)::float8`,
};

type PeriodKey = keyof typeof periodSql;

/** A select list `builder AS key<suffix>, …` for the given builders. */
export function periodColumns(keys: readonly PeriodKey[], s: DashboardScope, w: Window, suffix = ''): SQL {
  return sql.join(
    keys.map((k) => sql`${periodSql[k](s, w)} AS ${sql.identifier(`${k}${suffix}`)}`),
    sql`, `,
  );
}

const num = (v: unknown): number => Number(v ?? 0);
const orNull = (v: unknown): number | null => (v == null ? null : Number(v));
/** A share of `n` over `d`, null when there's nothing to measure. */
const share = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null);
/** Hours to one decimal. */
const hours = (v: number | null): number | null => (v == null ? null : Math.round(v * 10) / 10);

/** "Right now" (§6.1 section 3). */
export async function snapshotMetrics(
  conn: Conn,
  q: Pick<AdminDashboardQuery, 'city' | 'industrialAreaId' | 'categoryId'>,
): Promise<AdminDashboard['snapshot']> {
  const s = dashboardScope(q);
  const keys = Object.keys(snapshotSql) as (keyof typeof snapshotSql)[];
  const { rows } = await conn.execute<Record<string, unknown>>(
    sql`SELECT ${sql.join(
      keys.map((k) => sql`${snapshotSql[k](s)} AS ${sql.identifier(k)}`),
      sql`, `,
    )}`,
  );
  const r = rows[0]!;
  return Object.fromEntries(keys.map((k) => [k, num(r[k])])) as AdminDashboard['snapshot'];
}

const PERIOD_KEYS: readonly PeriodKey[] = [
  'newBusinesses',
  'enquiries',
  'offers',
  'deals',
  'dealValuePaise',
  'dealsCompleted',
  'rentalBookings',
  'rentalValuePaise',
  'soldListings',
  'closedListings',
  'requirementsPosted',
  'requirementsMatched',
  'fulfilmentMedianHours',
  'replyMeasured',
  'replyAnswered24h',
  'firstReplyMedianHours',
];

async function periodRow(conn: Conn, s: DashboardScope, w: Window): Promise<Record<string, unknown>> {
  const { rows } = await conn.execute<Record<string, unknown>>(sql`SELECT ${periodColumns(PERIOD_KEYS, s, w)}`);
  return rows[0]!;
}

/** "In the period" (§6.1 section 4): every metric over the period and the previous one, with the same builders. */
export async function periodMetrics(
  conn: Conn,
  q: Pick<AdminDashboardQuery, 'city' | 'industrialAreaId' | 'categoryId'>,
  period: DashboardPeriod,
): Promise<AdminDashboard['metrics']> {
  const s = dashboardScope(q);
  const w = periodWindows(period);
  const [cur, prev] = await Promise.all([periodRow(conn, s, w.current), periodRow(conn, s, w.previous)]);
  const count = (k: PeriodKey): PeriodCount => ({ value: num(cur[k]), previous: num(prev[k]) });
  const rate = (f: (r: Record<string, unknown>) => number | null): PeriodRate => ({ value: f(cur), previous: f(prev) });
  return {
    newBusinesses: count('newBusinesses'),
    enquiries: count('enquiries'),
    offers: count('offers'),
    deals: count('deals'),
    dealValuePaise: count('dealValuePaise'),
    dealsCompleted: count('dealsCompleted'),
    rentalBookings: count('rentalBookings'),
    rentalValuePaise: count('rentalValuePaise'),
    soldListings: count('soldListings'),
    closedListings: count('closedListings'),
    requirementsPosted: count('requirementsPosted'),
    requirementMatchRate: rate((r) => share(num(r.requirementsMatched), num(r.requirementsPosted))),
    fulfilmentMedianHours: rate((r) => hours(orNull(r.fulfilmentMedianHours))),
    replyRate24h: rate((r) => share(num(r.replyAnswered24h), num(r.replyMeasured))),
    firstReplyMedianHours: rate((r) => hours(orNull(r.firstReplyMedianHours))),
  };
}

// ─── The page (A1-2): cache 60 s per filter combination (R4, role-independent) ───

export const DASHBOARD_CACHE_SECONDS = 60;

/** The query with defaults applied and nothing that doesn't change the answer (dates only for `custom`). */
function normalised(q: AdminDashboardQuery) {
  const city = q.city?.trim().toLowerCase();
  return {
    range: q.range,
    from: q.range === 'custom' ? q.from ?? null : null,
    to: q.range === 'custom' ? q.to ?? null : null,
    city: city || null,
    industrialAreaId: q.industrialAreaId ?? null,
    categoryId: q.categoryId ?? null,
    breakdown: q.breakdown ?? 'city',
  };
}

/** `<prefix>dashboard:<today>:<sha1 of the normalised query>`. */
export function dashboardCacheKey(q: AdminDashboardQuery, today: string): string {
  const hash = createHash('sha1').update(JSON.stringify(normalised(q))).digest('hex');
  return `${discoveryRedisPrefix()}dashboard:${today}:${hash}`;
}

/**
 * `GET /admin/dashboard` (§6.3): snapshot, period metrics with the previous period, trend and the one breakdown asked
 * for (plan D6). A bad custom range is refused before the cache (`400 DASHBOARD_RANGE_INVALID`). Cached 60 s in Redis
 * when there is one; `generatedAt` says when the numbers were read.
 */
export async function getAdminDashboard(
  deps: { db: Db; redis?: Redis },
  q: AdminDashboardQuery,
  opts: { today?: string } = {},
): Promise<AdminDashboard> {
  const today = opts.today ?? istToday();
  const period = resolveDashboardPeriod(q, today);
  const key = dashboardCacheKey(q, today);
  if (deps.redis) {
    const hit = await deps.redis.get(key);
    if (hit) return JSON.parse(hit) as AdminDashboard;
  }
  const by = q.breakdown ?? 'city';
  const [snapshot, metrics, trend, breakdown] = await Promise.all([
    snapshotMetrics(deps.db, q),
    periodMetrics(deps.db, q, period),
    dashboardTrend(deps.db, q, period),
    dashboardBreakdown(deps.db, q, period, by),
  ]);
  const result: AdminDashboard = {
    generatedAt: new Date().toISOString(),
    period: { from: period.from, to: period.to, prevFrom: period.prevFrom, prevTo: period.prevTo, granularity: period.granularity },
    snapshot,
    metrics,
    trend,
    breakdown: { by, rows: breakdown },
  };
  if (deps.redis) await deps.redis.set(key, JSON.stringify(result), 'EX', DASHBOARD_CACHE_SECONDS);
  return result;
}
