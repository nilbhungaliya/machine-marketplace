import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  DISCOVERY_LIMITS,
  type BrandBrowseRequest,
  type BrandBrowseView,
  type BrowseRequest,
  type BrowseView,
  type CatalogLevel,
  type CategoryIcon,
} from '@mpm/shared-types';
import type { Db } from '../../db/index.js';
import { brands, categories, listings, machineModels } from '../../db/schema.js';
import { NotFoundError } from '../../lib/errors.js';
import type { OriginViewer } from './origin.js';
import { brandChipSql } from './filters.js';
import { inSubtreeSql, resolveScope, scopeWhere, type DiscoveryScope } from './scope.js';

// Browse (F4 + F5 spec §7, §8.4): the admin catalogue walked with live counts. One grouped count per call (listings joined
// to their category, counted under each child by `path` prefix), within the radius when there is an origin, else All
// India; children with no listings are hidden. "Popular brands here": the most listed part, fitment and machine brands
// under the node. The brand view: the brand's models with counts (as the fits-machine filter counts them) and the
// count of the search its "All" row opens (the `brandId` filter).

/** A node and its ancestors, root first; null when the node or any ancestor is missing or inactive. */
async function activeTrail(db: Db, id: string): Promise<Array<typeof categories.$inferSelect> | null> {
  const [node] = await db.select().from(categories).where(eq(categories.id, id));
  if (!node || !node.isActive) return null;
  const parts = node.path.split('/');
  const paths = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  const rows = await db.select().from(categories).where(inArray(categories.path, paths));
  if (rows.length !== paths.length || rows.some((r) => !r.isActive)) return null;
  return rows.sort((a, b) => a.path.length - b.path.length);
}

/** Listings in scope per child node (the child or a descendant), for the given children. */
async function childCounts(db: Db, scope: DiscoveryScope, childIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (childIds.length === 0) return out;
  const { rows } = await db.execute<{ id: string; n: number }>(sql`
    SELECT ch.id, count(*)::int AS n
    FROM categories ch
    JOIN categories c ON (c.path = ch.path OR c.path LIKE ch.path || '/%')
    JOIN listings ON listings.category_id = c.id
    WHERE ch.id IN (${sql.join(childIds.map((id) => sql`${id}::uuid`), sql`, `)}) AND ${scopeWhere(scope)}
    GROUP BY ch.id`);
  for (const r of rows) out.set(r.id, Number(r.n));
  return out;
}

/** The most listed active brands among the listings in scope (part brand, fitment brands, machine make). */
async function popularBrands(db: Db, scope: DiscoveryScope, subtree: SQL | null): Promise<BrowseView['popularBrands']> {
  const where = scopeWhere(scope, [subtree]);
  const { rows } = await db.execute<{ id: string; name: string; n: number }>(sql`
    SELECT b.id, b.name, count(DISTINCT x.listing_id)::int AS n
    FROM (
      SELECT listings.id AS listing_id, listings.part_brand_id AS brand_id FROM listings
        WHERE listings.part_brand_id IS NOT NULL AND ${where}
      UNION ALL
      SELECT pf.listing_id, pf.brand_id FROM listing_fitments pf JOIN listings ON listings.id = pf.listing_id WHERE ${where}
      UNION ALL
      SELECT pm.listing_id, pm.brand_id FROM listing_machines pm JOIN listings ON listings.id = pm.listing_id
        WHERE pm.brand_id IS NOT NULL AND ${where}
    ) x
    JOIN brands b ON b.id = x.brand_id AND b.is_active
    GROUP BY b.id, b.name
    ORDER BY n DESC, b.name, b.id
    LIMIT ${DISCOVERY_LIMITS.popularBrands}`);
  return rows.map((r) => ({ id: r.id, name: r.name, liveCount: Number(r.n) }));
}

/** `POST /discover/browse`: the node's (or the roots') active children with counts, crumbs and popular brands. */
export async function browse(db: Db, req: BrowseRequest, viewer: OriginViewer): Promise<BrowseView> {
  const scope = await resolveScope(db, req, viewer);
  let trail: Array<typeof categories.$inferSelect> = [];
  if (req.parentId) {
    const found = await activeTrail(db, req.parentId);
    if (!found) throw new NotFoundError('Category');
    trail = found;
  }
  const node = trail[trail.length - 1] ?? null;

  const children = await db
    .select({ id: categories.id, name: categories.name, level: categories.level, icon: categories.icon })
    .from(categories)
    .where(and(node ? eq(categories.parentId, node.id) : isNull(categories.parentId), eq(categories.isActive, true)))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  const counts = await childCounts(db, scope, children.map((c) => c.id));

  return {
    node: node ? { id: node.id, name: node.name, level: node.level as CatalogLevel } : null,
    crumbs: trail.map((c) => ({ id: c.id, name: c.name })),
    children: children
      .map((c) => ({ id: c.id, name: c.name, level: c.level as CatalogLevel, icon: c.icon as CategoryIcon | null, liveCount: counts.get(c.id) ?? 0 }))
      .filter((c) => c.liveCount > 0),
    popularBrands: await popularBrands(db, scope, node ? inSubtreeSql(node.path) : null),
    origin: scope.origin.echo,
    radiusKm: scope.radiusKm,
  };
}

/**
 * `POST /discover/browse/brand`: the brand's active models with the listings in scope that fit each one (a fitment of
 * the model or a brand-wide fitment of the brand, or a machine of that model: the fits-machine filter's rule, §5.7),
 * models with none hidden; `allCount` = the search total for the `brandId` filter (the brand chip's meaning).
 */
export async function browseBrand(db: Db, req: BrandBrowseRequest, viewer: OriginViewer): Promise<BrandBrowseView> {
  const [brand] = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(and(eq(brands.id, req.brandId), eq(brands.isActive, true)));
  if (!brand) throw new NotFoundError('Brand');
  const scope = await resolveScope(db, req, viewer);
  const b = brand.id;

  // One grouped count: (listing, model) pairs from fitments of a model, brand-wide fitments (model NULL: every model of
  // the brand) and machines, joined to the brand's active models and to the listings in scope.
  const { rows: counted } = await db.execute<{ id: string; n: number }>(sql`
    SELECT am.id, count(DISTINCT ${listings.id})::int AS n
    FROM (
      SELECT xf.listing_id, xf.model_id FROM listing_fitments xf
        WHERE xf.brand_id = ${b} AND (xf.model_id IS NOT NULL OR xf.model_other IS NULL)
      UNION
      SELECT xm.listing_id, xm.model_id FROM listing_machines xm
        WHERE xm.brand_id = ${b} AND xm.model_id IS NOT NULL
    ) x
    JOIN machine_models am ON am.brand_id = ${b} AND am.is_active AND (x.model_id = am.id OR x.model_id IS NULL)
    JOIN listings ON ${listings.id} = x.listing_id
    WHERE ${scopeWhere(scope)}
    GROUP BY am.id`);
  const countOf = new Map(counted.map((r) => [r.id, Number(r.n)]));

  const models = await db
    .select({ id: machineModels.id, name: machineModels.name })
    .from(machineModels)
    .where(and(eq(machineModels.brandId, b), eq(machineModels.isActive, true)))
    .orderBy(asc(machineModels.sortOrder), asc(machineModels.name), asc(machineModels.id));

  const { rows } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM listings WHERE ${scopeWhere(scope, [brandChipSql(b)])}`);

  return {
    brand,
    models: models.filter((m) => (countOf.get(m.id) ?? 0) > 0).map((m) => ({ id: m.id, name: m.name, liveCount: countOf.get(m.id)! })),
    allCount: Number(rows[0]?.n ?? 0),
  };
}
