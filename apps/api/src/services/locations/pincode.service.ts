import { sql, type SQL } from 'drizzle-orm';
import type { PincodeInfo } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';

// Where a pincode is (F1 spec §4.2, §4.4), from `pincode_offices` (one row per post office, several per pincode).
// Ported from textile's location.service `lookupPincode` and delivery-places `titleCase`, minus market cities.

/** Search radius for "Use my location": beyond it the app falls back to typing the pincode. */
const NEAREST_MAX_METRES = 50_000;

/** The directory writes some names in capitals: `NAVSARI` reads Navsari, `KAIMUR (BHABUA)` reads Kaimur (Bhabua). */
export function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/**
 * **The one definition of a pincode's district**, as a subquery yielding `(pincode, district, state)`, one row per
 * pincode: among the pincode's offices, the (district, state) with the most offices; a tie goes to the alphabetically
 * first district, then state. `pincodes` (optional) narrows it: a single value (`sql\`${pin}\``) or a subquery of
 * pincodes. Use it as `FROM ${pincodeDistrictSql(...)} AS pd` in set-based queries; `pincodeDistrict` uses it too.
 */
export function pincodeDistrictSql(pincodes?: SQL): SQL {
  return sql`(
    SELECT DISTINCT ON (counted.pincode) counted.pincode, counted.district, counted.state
    FROM (
      SELECT po.pincode, po.district, po.state, count(*) AS offices
      FROM pincode_offices po
      ${pincodes ? sql`WHERE po.pincode IN (${pincodes})` : sql``}
      GROUP BY po.pincode, po.district, po.state
    ) counted
    ORDER BY counted.pincode, counted.offices DESC, counted.district, counted.state
  )`;
}

export interface PincodeDistrict {
  district: string;
  state: string;
  /** `titleCase(district)`: what the app fills into City, and what `industrial_areas.city` is matched against. */
  city: string;
}

/** The pincode's district (by `pincodeDistrictSql`'s rule) and state; null when the directory doesn't have it. */
export async function pincodeDistrict(conn: Db | Tx, pincode: string): Promise<PincodeDistrict | null> {
  const { rows } = await conn.execute<{ district: string; state: string }>(
    sql`SELECT pd.district, pd.state FROM ${pincodeDistrictSql(sql`${pincode}`)} AS pd`,
  );
  const row = rows[0];
  return row ? { district: row.district, state: row.state, city: titleCase(row.district) } : null;
}

/** What the app fills in for a typed pincode; null when the directory doesn't have it. */
export async function lookupPincode(conn: Db | Tx, pincode: string): Promise<PincodeInfo | null> {
  const where = await pincodeDistrict(conn, pincode);
  if (!where) return null;
  const { rows } = await conn.execute<{ office_name: string }>(sql`
    SELECT DISTINCT office_name FROM pincode_offices WHERE pincode = ${pincode} ORDER BY office_name
  `);
  return { pincode, ...where, offices: rows.map((r) => r.office_name) };
}

/** "Use my location": the pincode of the nearest post office within 50 km (PostGIS distance); null beyond. */
export async function nearestPincode(conn: Db | Tx, lat: number, lng: number): Promise<PincodeInfo | null> {
  const here = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
  const { rows } = await conn.execute<{ pincode: string }>(sql`
    SELECT pincode FROM pincode_offices
    WHERE point IS NOT NULL AND ST_DWithin(point, ${here}, ${NEAREST_MAX_METRES})
    ORDER BY ST_Distance(point, ${here}), pincode
    LIMIT 1
  `);
  return rows[0] ? lookupPincode(conn, rows[0].pincode) : null;
}
