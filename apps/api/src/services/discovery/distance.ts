import { inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { DISCOVERY_LIMITS } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { centroidSql } from '../listings/listing-validate.service.js';

// Distances (F4 + F5 spec §6.2), shared by discovery and F2's other side / listing page (moved here from
// listing-view.service.ts). Coordinates never leave the API: only whole km do.

type Conn = Db | Tx;

export interface LatLng {
  lat: number;
  lng: number;
}

const GRID = DISCOVERY_LIMITS.snapDegrees;
/** The raw-distance prefilter's margin over the radius (§6.2): covers both points' snapping (≤ ~0.78 km each). */
export const RADIUS_MARGIN_KM = 3;

/** A point as `geography(Point,4326)`. */
export function pointSql({ lat, lng }: LatLng): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography`;
}

/** A point (column or expression) snapped to the 0.01° grid. */
export function snappedSql(point: SQL | AnyColumn): SQL {
  return sql`ST_SnapToGrid((${point})::geometry, ${GRID}::float8)::geography`;
}

/**
 * Whole km between the snapped point and the snapped origin (`floor`, at least 1; the app shows "Under 2 km" for 1);
 * NULL when the point is NULL. The only distance discovery shows, sorts or filters by.
 */
export function snappedKmSql(point: SQL | AnyColumn, origin: LatLng): SQL<number | null> {
  return sql<number | null>`(CASE WHEN (${point}) IS NULL THEN NULL
    ELSE GREATEST(1, floor(ST_Distance(${snappedSql(point)}, ${snappedSql(pointSql(origin))}) / 1000))::int END)`;
}

/**
 * Within `radiusKm` by the same number the card shows: `ST_DWithin` on the raw points with a 3 km margin (uses the
 * GiST index; snapping moves each point up to ~0.78 km, so the raw distance of a match can reach ~r + 2.6 km) **and**
 * the snapped km ≤ the radius, so a listing never shows "51 km" under 50 km.
 */
export function withinRadiusSql(point: SQL | AnyColumn, origin: LatLng, radiusKm: number): SQL {
  return sql`(ST_DWithin(${point}, ${pointSql(origin)}, ${(radiusKm + RADIUS_MARGIN_KM) * 1000}::float8) AND ${snappedKmSql(point, origin)} <= ${radiusKm})`;
}

/**
 * The viewer business's point (F2 §4.1, §9.1): its pin, else the centroid of its pincode's offices (as a
 * business-sourced listing's point, I8), else NULL.
 */
export function businessPointSql(businessId: string): SQL {
  return sql`(SELECT COALESCE(b.location, ${centroidSql(sql`b.pincode`)}) FROM businesses b WHERE b.id = ${businessId})`;
}

/**
 * F2's listing-page and card distance (F2 §8.1): whole km (rounded, unsnapped) between each listing's point and the
 * viewer business's point; absent when either is unknown. Discovery lists use `snappedKmSql` from an origin instead.
 */
export async function distancesKm(conn: Conn, listingIds: string[], viewerBusinessId: string | null | undefined): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!viewerBusinessId || listingIds.length === 0) return out;
  const rows = await conn
    .select({ id: listings.id, km: sql<number | null>`round(ST_Distance(${listings.point}, ${businessPointSql(viewerBusinessId)}) / 1000)::int` })
    .from(listings)
    .where(inArray(listings.id, listingIds));
  for (const r of rows) if (r.km != null) out.set(r.id, Number(r.km));
  return out;
}

/** Snapped whole km (§6.2) from an origin to each listing's `search_point` (R5); absent when the listing has none. */
export async function snappedDistancesKm(conn: Conn, listingIds: string[], origin: LatLng | null | undefined): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!origin || listingIds.length === 0) return out;
  const rows = await conn
    .select({ id: listings.id, km: snappedKmSql(listings.searchPoint, origin) })
    .from(listings)
    .where(inArray(listings.id, listingIds));
  for (const r of rows) if (r.km != null) out.set(r.id, Number(r.km));
  return out;
}
