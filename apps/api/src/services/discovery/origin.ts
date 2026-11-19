import { eq, sql, type SQL } from 'drizzle-orm';
import { DISCOVERY_LIMITS, type DiscoveryOrigin, type OriginEcho, type OriginSource } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, industrialAreas } from '../../db/schema.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import { centroidSql } from '../listings/listing-validate.service.js';
import { titleCase } from '../locations/pincode.service.js';
import { pointSql, type LatLng } from './distance.js';

// Where discovery measures from (F4 + F5 spec §6.3, R2, R3, R18). Coordinates arrive only in POST bodies, are snapped to
// the 0.01° grid here, are never stored or logged, and never go back: the echo carries a place name and the source.

type Conn = Db | Tx;

/** A signed-in viewer (`request.user`), or null for a guest. */
export type OriginViewer = { userId: string; businessId: string | null } | null | undefined;

export interface ResolvedOrigin {
  /** Snapped to 0.01°; null = no origin (All India, no distance). */
  point: LatLng | null;
  echo: OriginEcho;
}

/** India's bounding box (mainland plus the islands). A GPS point outside it is `out_of_range`, not an error. */
export const INDIA_BOUNDS = { minLat: 6.0, maxLat: 37.6, minLng: 68.0, maxLng: 97.5 } as const;

const PINCODE = /^\d{6}$/;
const GRID_STEPS = Math.round(1 / DISCOVERY_LIMITS.snapDegrees);

/** One coordinate on the 0.01° grid (R3). */
export function snapCoord(value: number): number {
  return Math.round(value * GRID_STEPS) / GRID_STEPS;
}

function snap(p: LatLng): LatLng {
  return { lat: snapCoord(p.lat), lng: snapCoord(p.lng) };
}

export function inIndia({ lat, lng }: LatLng): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= INDIA_BOUNDS.minLat &&
    lat <= INDIA_BOUNDS.maxLat &&
    lng >= INDIA_BOUNDS.minLng &&
    lng <= INDIA_BOUNDS.maxLng
  );
}

const NONE: ResolvedOrigin = { point: null, echo: { label: null, source: null } };

/** "Area, City" with the empty parts and a repeated city left out; null when both are empty. */
function joinLabel(area: string | null | undefined, city: string | null | undefined): string | null {
  const a = area?.trim() || null;
  const c = city?.trim() || null;
  if (a && c && a.toLowerCase() !== c.toLowerCase()) return `${a}, ${c}`;
  return a ?? c;
}

/** The nearest post office's name and district ("Udhna, Surat"), optionally among one pincode's offices. */
async function officeLabel(conn: Conn, point: LatLng, pincode?: string): Promise<string | null> {
  const here = pointSql(point);
  const { rows } = await conn.execute<{ office_name: string; district: string }>(sql`
    SELECT office_name, district FROM pincode_offices
    WHERE point IS NOT NULL ${pincode ? sql`AND pincode = ${pincode}` : sql``}
    ORDER BY point <-> ${here}, office_name, id
    LIMIT 1`);
  const row = rows[0];
  return row ? joinLabel(row.office_name, titleCase(row.district)) : null;
}

async function pointOf(conn: Conn, geography: SQL): Promise<LatLng | null> {
  const { rows } = await conn.execute<{ lat: number | null; lng: number | null }>(sql`
    SELECT ST_Y(g::geometry) AS lat, ST_X(g::geometry) AS lng FROM (SELECT ${geography} AS g) s`);
  const row = rows[0];
  return row && row.lat != null && row.lng != null ? { lat: Number(row.lat), lng: Number(row.lng) } : null;
}

async function fromPincode(conn: Conn, pincode: string, source: OriginSource): Promise<ResolvedOrigin> {
  const unknown = () => new ValidationError('We could not find this pincode', { pincode: 'unknown' }, 'PINCODE_UNKNOWN');
  if (!PINCODE.test(pincode)) throw unknown();
  const centroid = await pointOf(conn, centroidSql(pincode));
  if (!centroid) throw unknown();
  return { point: snap(centroid), echo: { label: await officeLabel(conn, centroid, pincode), source } };
}

async function fromBusiness(conn: Conn, viewer: OriginViewer, source: OriginSource): Promise<ResolvedOrigin> {
  if (!viewer) throw new UnauthorizedError('Sign in to use your business location');
  if (!viewer.businessId) return source === 'out_of_range' ? { point: null, echo: { label: null, source } } : NONE;
  const [b] = await conn
    .select({
      lat: sql<number | null>`ST_Y(COALESCE(${businesses.location}, ${centroidSql(sql`${businesses.pincode}`)})::geometry)`,
      lng: sql<number | null>`ST_X(COALESCE(${businesses.location}, ${centroidSql(sql`${businesses.pincode}`)})::geometry)`,
      areaName: industrialAreas.name,
      areaOther: businesses.industrialAreaOther,
      city: businesses.city,
    })
    .from(businesses)
    .leftJoin(industrialAreas, eq(industrialAreas.id, businesses.industrialAreaId))
    .where(eq(businesses.id, viewer.businessId));
  if (!b || b.lat == null || b.lng == null) return source === 'out_of_range' ? { point: null, echo: { label: null, source } } : NONE;
  return {
    point: snap({ lat: Number(b.lat), lng: Number(b.lng) }),
    echo: { label: joinLabel(b.areaName ?? b.areaOther, b.city), source },
  };
}

/**
 * Resolves a request's origin (§6.3):
 * - `point` inside India: snapped; labelled with the nearest office. Outside India it is not an error: the `fallback`
 *   (business or pincode) if given, else no origin, and the echo's source is `out_of_range`.
 * - `pincode`: the centroid of its offices (`400 PINCODE_UNKNOWN` when it has none); labelled with its office nearest
 *   the centroid.
 * - `business`: signed-in only (`401` for a guest): the business's pin, else its pincode's centroid, labelled with its
 *   industrial area (or "Other" text) and city; no business yet, or no location, is no origin.
 * - absent / null: no origin.
 */
export async function resolveOrigin(conn: Conn, origin: DiscoveryOrigin | undefined, viewer: OriginViewer): Promise<ResolvedOrigin> {
  if (!origin) return NONE;
  if ('point' in origin) {
    if (inIndia(origin.point)) {
      const point = snap(origin.point);
      return { point, echo: { label: await officeLabel(conn, point), source: 'gps' } };
    }
    const fallback = origin.fallback;
    if (fallback && 'pincode' in fallback) return fromPincode(conn, fallback.pincode, 'out_of_range');
    if (fallback && 'business' in fallback) return fromBusiness(conn, viewer, 'out_of_range');
    return { point: null, echo: { label: null, source: 'out_of_range' } };
  }
  if ('pincode' in origin) return fromPincode(conn, origin.pincode, 'pincode');
  return fromBusiness(conn, viewer, 'business');
}
