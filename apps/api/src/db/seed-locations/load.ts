import { isNull, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../index.js';
import { pincodeOffices } from '../schema.js';
import type { OfficeRow } from './parse.js';

// Ported from the textile project's seed-locations/load.ts, minus market cities (F1 spec §4.4).

export const ALREADY_LOADED = 'Pincode directory already loaded. Use --reset to replace it.';

const BATCH_SIZE = 2000;

/** A point further than this from its district's median is treated as wrong. */
const MAX_METRES_FROM_DISTRICT_MEDIAN = 150_000;

/** Inserts the rows in batches and returns how many. Points are `null` where the file has none usable. */
export async function loadPincodeOffices(tx: Tx, rows: OfficeRow[]): Promise<number> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await tx.insert(pincodeOffices).values(
      rows.slice(i, i + BATCH_SIZE).map((r) => ({
        pincode: r.pincode,
        officeName: r.officeName,
        district: r.district,
        state: r.state,
        point:
          r.lat === null || r.lng === null ? null : sql`ST_SetSRID(ST_MakePoint(${r.lng}, ${r.lat}), 4326)::geography`,
      })),
    );
  }
  return rows.length;
}

/** The median point of the matching non-null rows, by each axis. */
const medianPoint = sql`ST_SetSRID(ST_MakePoint(
  percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_X(point::geometry)),
  percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_Y(point::geometry))
), 4326)::geography`;

/**
 * Limited to these districts: a point that is missing or too far from its district's median takes that median.
 * A district with no point at all takes its state's median. A state with no point at all stays null.
 */
export async function fillOfficePoints(tx: Tx, districts: { district: string; state: string }[]): Promise<void> {
  if (districts.length === 0) return;
  const pairs: SQL = sql.join(
    districts.map((d) => sql`(${d.district}::text, ${d.state}::text)`),
    sql`, `,
  );
  await tx.execute(sql`
    WITH medians AS (
      SELECT district, state, ${medianPoint} AS median
      FROM pincode_offices
      WHERE point IS NOT NULL AND (district, state) IN (VALUES ${pairs})
      GROUP BY district, state
    )
    UPDATE pincode_offices o SET point = m.median
    FROM medians m
    WHERE o.district = m.district AND o.state = m.state
      AND (o.point IS NULL OR ST_Distance(o.point, m.median) > ${MAX_METRES_FROM_DISTRICT_MEDIAN})
  `);
  await tx.execute(sql`
    WITH medians AS (
      SELECT state, ${medianPoint} AS median
      FROM pincode_offices
      WHERE point IS NOT NULL
      GROUP BY state
    )
    UPDATE pincode_offices o SET point = m.median
    FROM medians m
    WHERE o.state = m.state AND o.point IS NULL AND (o.district, o.state) IN (VALUES ${pairs})
  `);
}

/**
 * The whole load. Refuses when `pincode_offices` has rows, unless `reset`. Businesses store the pincode as text, so a
 * reset is always allowed and only replaces this table.
 */
export async function loadDirectory(
  tx: Tx,
  rows: OfficeRow[],
  { reset = false }: { reset?: boolean } = {},
): Promise<{ offices: number; pincodes: number; pointsMissing: number }> {
  const [existing] = await tx.select({ id: pincodeOffices.id }).from(pincodeOffices).limit(1);
  if (existing && !reset) throw new Error(ALREADY_LOADED);
  if (reset) await tx.delete(pincodeOffices);

  const offices = await loadPincodeOffices(tx, rows);
  const districts = new Map(rows.map((r) => [`${r.district}|${r.state}`, { district: r.district, state: r.state }]));
  await fillOfficePoints(tx, [...districts.values()]);

  const [missing] = await tx.select({ n: sql<number>`count(*)::int` }).from(pincodeOffices).where(isNull(pincodeOffices.point));
  return { offices, pincodes: new Set(rows.map((r) => r.pincode)).size, pointsMissing: missing!.n };
}
