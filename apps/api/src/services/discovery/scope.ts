import { and, inArray, sql, type SQL } from 'drizzle-orm';
import { DEFAULT_RADIUS_KM, type DiscoveryOrigin, type DiscoveryRadiusKm, type ListingKind } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { withinRadiusSql, type LatLng } from './distance.js';
import { resolveOrigin, type OriginViewer, type ResolvedOrigin } from './origin.js';
import { discoveryWhere } from './visibility.js';

// The scope Home, Browse and the brand view count and list in (F4 + F5 spec §7): what discovery shows (`discoveryWhere`,
// R7) for the kinds asked for, within the radius of the resolved origin (§6.2, from `search_point` only), with the same
// origin rules as search (§6.3, R18).

type Conn = Db | Tx;

export interface DiscoveryScope {
  origin: ResolvedOrigin;
  /** Effective radius: the request's (default 50 km) with an origin; null = All India, always null without one. */
  radiusKm: DiscoveryRadiusKm | null;
  kinds: ListingKind[];
}

/** Resolves a request's origin, radius and kinds. */
export async function resolveScope(
  conn: Conn,
  req: { origin?: DiscoveryOrigin | null; radiusKm?: DiscoveryRadiusKm | null; kinds?: readonly ListingKind[] | null },
  viewer: OriginViewer,
): Promise<DiscoveryScope> {
  const origin = await resolveOrigin(conn, req.origin ?? undefined, viewer);
  const radiusKm = origin.point ? (req.radiusKm === undefined ? DEFAULT_RADIUS_KM : req.radiusKm) : null;
  return { origin, radiusKm, kinds: [...new Set(req.kinds ?? [])].sort() as ListingKind[] };
}

/** Within the scope's radius of its origin; null when there is no radius (All India or no origin). */
export function scopeRadiusSql(scope: DiscoveryScope): SQL | null {
  const point: LatLng | null = scope.origin.point;
  return point && scope.radiusKm !== null ? withinRadiusSql(listings.searchPoint, point, scope.radiusKm) : null;
}

/**
 * `listings` rows in scope: discovery's visibility for the kinds (rented rentals only where rentals are asked for), the
 * kinds themselves, and the radius; plus `extra` conditions.
 */
export function scopeWhere(scope: DiscoveryScope, extra: Array<SQL | null | undefined> = []): SQL {
  const conds: SQL[] = [discoveryWhere(listings, { kinds: scope.kinds })];
  if (scope.kinds.length) conds.push(inArray(listings.kind, scope.kinds));
  const radius = scopeRadiusSql(scope);
  if (radius) conds.push(radius);
  for (const e of extra) if (e) conds.push(e);
  return and(...conds)!;
}

/** The listing is in a category node or one of its descendants (by path). */
export function inSubtreeSql(path: string): SQL {
  return sql`${listings.categoryId} IN (SELECT sc.id FROM categories sc WHERE sc.path = ${path} OR sc.path LIKE ${`${path}/%`})`;
}
