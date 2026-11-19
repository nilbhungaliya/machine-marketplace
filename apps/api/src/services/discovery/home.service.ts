import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { DISCOVERY_LIMITS, type CategoryIcon, type HomeRequest, type HomeView, type ListingKind } from '@mpm/shared-types';
import type { Db } from '../../db/index.js';
import { businesses, categories, listings } from '../../db/schema.js';
import { cardsInOrder } from './cards.service.js';
import type { OriginViewer } from './origin.js';
import { relevanceSql, tierSql } from './ranking.js';
import { resolveScope, scopeRadiusSql, scopeWhere, type DiscoveryScope } from './scope.js';
import { discoveryWhere } from './visibility.js';

// Home (F4 + F5 spec §7, §8.3, R15): kind tiles with public counts within the radius, the root categories in admin order,
// "Top items near you" (parts and machines by relevance, §6.1; restricted to the viewer business's machine categories
// only when that gives at least 4) and "Machines for rent nearby" (every available rental before a rented one).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TILE_KINDS: readonly ListingKind[] = ['part', 'machine', 'machine_rental'];
const TOP_KINDS: ListingKind[] = ['machine', 'part'];

export interface HomeDeps {
  /** The relevance clock (tests). */
  now?: () => Date;
}

/** The viewer business's machine categories (F1 onboarding), as valid ids. */
async function businessCategoryIds(db: Db, businessId: string | null | undefined): Promise<string[]> {
  if (!businessId) return [];
  const [row] = await db.select({ categories: businesses.categories }).from(businesses).where(eq(businesses.id, businessId));
  const ids = Array.isArray(row?.categories) ? row.categories : [];
  return ids.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id));
}

/** The listing sits under one of these category nodes (by path). */
function underAnySql(categoryIds: string[]): SQL {
  return sql`EXISTS (
    SELECT 1 FROM categories hc JOIN categories hr ON hr.id = ANY(${sql.param(categoryIds)}::uuid[])
    WHERE hc.id = ${listings.categoryId} AND (hc.path = hr.path OR hc.path LIKE hr.path || '/%'))`;
}

async function topIds(db: Db, scope: DiscoveryScope, asOf: Date, extra: SQL | null): Promise<string[]> {
  const relevance = relevanceSql({ asOf, origin: scope.origin.point, radiusKm: scope.radiusKm });
  const rows = await db
    .select({ id: listings.id })
    .from(listings)
    .where(scopeWhere({ ...scope, kinds: TOP_KINDS }, [extra]))
    .orderBy(sql`${relevance} DESC`, asc(listings.id))
    .limit(DISCOVERY_LIMITS.homeSectionSize);
  return rows.map((r) => r.id);
}

async function rentIds(db: Db, scope: DiscoveryScope, asOf: Date): Promise<string[]> {
  const relevance = relevanceSql({ asOf, origin: scope.origin.point, radiusKm: scope.radiusKm });
  const rows = await db
    .select({ id: listings.id })
    .from(listings)
    .where(scopeWhere({ ...scope, kinds: ['machine_rental'] }))
    .orderBy(sql`${tierSql({ side: null })} DESC`, sql`${relevance} DESC`, asc(listings.id))
    .limit(DISCOVERY_LIMITS.homeSectionSize);
  return rows.map((r) => r.id);
}

/** Public counts per kind within the radius (rented rentals count under For rent, as the rentals list shows them). */
async function kindTiles(db: Db, scope: DiscoveryScope): Promise<HomeView['kindTiles']> {
  const radius = scopeRadiusSql(scope);
  const cols = TILE_KINDS.map((k) => sql`count(*) FILTER (WHERE ${listings.kind} = ${k})::int AS ${sql.identifier(k)}`);
  const { rows } = await db.execute<Record<string, number>>(sql`
    SELECT ${sql.join(cols, sql`, `)} FROM listings
    WHERE ${discoveryWhere(listings)}${radius ? sql` AND ${radius}` : sql``}`);
  const row = rows[0] ?? {};
  return TILE_KINDS.map((kind) => ({ kind, count: Number(row[kind] ?? 0) }));
}

async function rootCategories(db: Db): Promise<HomeView['rootCategories']> {
  const rows = await db
    .select({ id: categories.id, name: categories.name, icon: categories.icon })
    .from(categories)
    .where(and(isNull(categories.parentId), eq(categories.isActive, true)))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  return rows.map((r) => ({ id: r.id, name: r.name, icon: r.icon as CategoryIcon | null }));
}

/** `POST /discover/home`. */
export async function home(db: Db, req: HomeRequest, viewer: OriginViewer, deps: HomeDeps = {}): Promise<HomeView> {
  const scope = await resolveScope(db, { origin: req.origin, radiusKm: req.radiusKm }, viewer);
  const asOf = deps.now?.() ?? new Date();

  let top: string[] | null = null;
  const own = await businessCategoryIds(db, viewer?.businessId);
  if (own.length) {
    const restricted = await topIds(db, scope, asOf, underAnySql(own));
    if (restricted.length >= DISCOVERY_LIMITS.homeRestrictMinItems) top = restricted;
  }
  top ??= await topIds(db, scope, asOf, null);
  const rent = await rentIds(db, scope, asOf);

  const cardOpts = { viewerUserId: viewer?.userId ?? null, origin: scope.origin.point };
  return {
    origin: scope.origin.echo,
    radiusKm: scope.radiusKm,
    kindTiles: await kindTiles(db, scope),
    rootCategories: await rootCategories(db),
    topNearYou: await cardsInOrder(db, top, cardOpts),
    rentNearby: await cardsInOrder(db, rent, cardOpts),
  };
}
