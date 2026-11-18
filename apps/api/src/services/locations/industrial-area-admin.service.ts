import { and, asc, eq, max, sql, type SQL } from 'drizzle-orm';
import type { IndustrialArea } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, industrialAreas } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../lib/pg-errors.js';
import { writeAudit } from '../audit.service.js';
import { assertExactSet } from '../catalog/reorder.js';
import { toIndustrialArea, type IndustrialAreaRow } from './industrial-areas.service.js';
import { pincodeDistrictSql, titleCase } from './pincode.service.js';

// Admin writes on industrial areas (F1 spec §4.3, §8.3; `category_manager`). Each write runs in one transaction and
// writes one audit_log row with it (`industrial_area.create|update|reorder|delete|adopt`).

const NAME_CONSTRAINT = 'industrial_areas_name_city_state_uq';
/** Gap between sort orders, as the seed (10, 20, …), so a manual insert between two needs no renumbering. */
const SORT_STEP = 10;

/** The unique index (lower(name), lower(city), state) is the backstop for a name already used in that city. */
async function mapNameTaken<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isUniqueViolation(err, NAME_CONSTRAINT)) throw new ConflictError('This city already has an area with that name', 'NAME_TAKEN');
    throw err;
  }
}

/** One city's areas: the city ignoring case, the state exactly (as the app's picker matches them). */
function sameCity(city: string, state: string): SQL {
  return and(sql`lower(${industrialAreas.city}) = lower(${city})`, eq(industrialAreas.state, state))!;
}

async function nextSortOrder(tx: Tx, city: string, state: string): Promise<number> {
  const [last] = await tx.select({ value: max(industrialAreas.sortOrder) }).from(industrialAreas).where(sameCity(city, state));
  return (last?.value ?? 0) + SORT_STEP;
}

async function lockArea(tx: Tx, id: string): Promise<IndustrialAreaRow> {
  const [row] = await tx.select().from(industrialAreas).where(eq(industrialAreas.id, id)).for('update');
  if (!row) throw new NotFoundError('Industrial area');
  return row;
}

async function insertArea(tx: Tx, input: { name: string; city: string; state: string }): Promise<IndustrialArea> {
  const sortOrder = await nextSortOrder(tx, input.city, input.state);
  const [row] = await tx.insert(industrialAreas).values({ ...input, sortOrder }).returning();
  return toIndustrialArea(row!);
}

/** Every area (active and inactive unless told otherwise), by state, city, sort order and name. */
export async function listAreas(
  db: Db | Tx,
  { city, state, includeInactive = true }: { city?: string; state?: string; includeInactive?: boolean } = {},
): Promise<IndustrialArea[]> {
  const rows = await db
    .select()
    .from(industrialAreas)
    .where(
      and(
        city ? sql`lower(${industrialAreas.city}) = lower(${city})` : undefined,
        state ? eq(industrialAreas.state, state) : undefined,
        includeInactive ? undefined : eq(industrialAreas.isActive, true),
      ),
    )
    .orderBy(asc(industrialAreas.state), sql`lower(${industrialAreas.city})`, asc(industrialAreas.sortOrder), asc(industrialAreas.name));
  return rows.map(toIndustrialArea);
}

/** The new area goes last in its city. */
export async function createArea(
  db: Db,
  adminId: string,
  input: { name: string; city: string; state: string },
): Promise<IndustrialArea> {
  return mapNameTaken(() =>
    db.transaction(async (tx) => {
      const area = await insertArea(tx, input);
      await writeAudit(tx, { adminId, action: 'industrial_area.create', entityType: 'industrial_area', entityId: area.id, before: null, after: area });
      return area;
    }),
  );
}

/** Rename and / or activate / deactivate. A deactivated area leaves the picker; businesses keep it. */
export async function updateArea(
  db: Db,
  adminId: string,
  id: string,
  patch: { name?: string; isActive?: boolean },
): Promise<IndustrialArea> {
  return mapNameTaken(() =>
    db.transaction(async (tx) => {
      const before = await lockArea(tx, id);
      const [after] = await tx
        .update(industrialAreas)
        .set({ name: patch.name, isActive: patch.isActive, updatedAt: new Date() })
        .where(eq(industrialAreas.id, id))
        .returning();
      const area = toIndustrialArea(after!);
      await writeAudit(tx, {
        adminId,
        action: 'industrial_area.update',
        entityType: 'industrial_area',
        entityId: id,
        before: toIndustrialArea(before),
        after: area,
      });
      return area;
    }),
  );
}

/** `ids` must be exactly the city's areas (active and inactive), else `409 STALE_ORDER`. */
export async function reorderAreas(
  db: Db,
  adminId: string,
  { city, state, ids }: { city: string; state: string; ids: string[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await tx
      .select({ id: industrialAreas.id })
      .from(industrialAreas)
      .where(sameCity(city, state))
      .orderBy(asc(industrialAreas.sortOrder), asc(industrialAreas.name))
      .for('update');
    assertExactSet(current, ids, 'industrial areas');
    for (const [index, id] of ids.entries()) {
      await tx
        .update(industrialAreas)
        .set({ sortOrder: (index + 1) * SORT_STEP, updatedAt: new Date() })
        .where(eq(industrialAreas.id, id));
    }
    await writeAudit(tx, {
      adminId,
      action: 'industrial_area.reorder',
      entityType: 'industrial_area',
      entityId: null,
      before: { city, state, ids: current.map((r) => r.id) },
      after: { city, state, ids },
    });
  });
}

/** Only an area no business uses (`409 AREA_IN_USE`); deactivate it otherwise. */
export async function deleteArea(db: Db, adminId: string, id: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const before = await lockArea(tx, id);
      const [user] = await tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.industrialAreaId, id)).limit(1);
      if (user) throw new ConflictError('Businesses use this area: deactivate it instead', 'AREA_IN_USE');
      await tx.delete(industrialAreas).where(eq(industrialAreas.id, id));
      await writeAudit(tx, {
        adminId,
        action: 'industrial_area.delete',
        entityType: 'industrial_area',
        entityId: id,
        before: toIndustrialArea(before),
        after: null,
      });
    });
  } catch (err) {
    // A business picked the area between the check and the delete.
    if (isForeignKeyViolation(err)) throw new ConflictError('Businesses use this area: deactivate it instead', 'AREA_IN_USE');
    throw err;
  }
}

export interface OtherValue {
  /** `lower(trim(industrial_area_other))`. */
  text: string;
  /** The pincode's district (`pincodeDistrictSql`); the typed city when the directory doesn't know the pincode. */
  district: string;
  state: string;
  /** How many businesses typed it there. */
  count: number;
  /** False for businesses whose pincode the directory doesn't have: Add to list can't link them. */
  adoptable: boolean;
}

/**
 * The "Other" texts businesses typed, grouped by the **pincode's** district and state (not the editable city), most
 * typed first. A business whose pincode is unknown to the directory is listed under its typed city and state.
 */
export async function listOtherValues(db: Db | Tx): Promise<OtherValue[]> {
  const { rows } = await db.execute<{ text: string; district: string; state: string; count: number; adoptable: boolean }>(sql`
    WITH typed AS (
      SELECT lower(trim(b.industrial_area_other)) AS text, b.pincode, b.city, b.state
      FROM businesses b
      WHERE b.industrial_area_other IS NOT NULL AND trim(b.industrial_area_other) <> ''
    )
    SELECT t.text,
           coalesce(pd.district, t.city, '') AS district,
           coalesce(pd.state, t.state, '') AS state,
           count(*)::int AS count,
           (pd.district IS NOT NULL) AS adoptable
    FROM typed t
    LEFT JOIN ${pincodeDistrictSql(sql`SELECT pincode FROM typed`)} AS pd ON pd.pincode = t.pincode
    GROUP BY 1, 2, 3, 5
    ORDER BY count DESC, adoptable DESC, t.text, 2, 3
  `);
  return rows.map((r) => ({ text: r.text, district: r.district, state: r.state, count: Number(r.count), adoptable: r.adoptable }));
}

/**
 * Add to list: creates the area `name` for the district (`city` = `titleCase(district)`) and state, then links every
 * business whose pincode resolves (`pincodeDistrictSql`) to that district and state and whose Other text matches
 * `text` ignoring case and surrounding spaces, clearing that text. One transaction, one audit row.
 */
export async function adoptOtherValue(
  db: Db,
  adminId: string,
  input: { text: string; district: string; state: string; name: string },
): Promise<{ areaId: string; linked: number }> {
  return mapNameTaken(() =>
    db.transaction(async (tx) => {
      const { rows: known } = await tx.execute(sql`
        SELECT 1 FROM pincode_offices WHERE lower(district) = lower(${input.district}) AND state = ${input.state} LIMIT 1
      `);
      if (known.length === 0) {
        throw new ValidationError("The pincode directory doesn't have this district: unknown pincodes can't be linked", undefined, 'UNKNOWN_DISTRICT');
      }

      const area = await insertArea(tx, { name: input.name, city: titleCase(input.district), state: input.state });
      const sameText = sql`lower(trim(industrial_area_other)) = lower(trim(${input.text}))`;
      const { rows: linked } = await tx.execute<{ id: string }>(sql`
        UPDATE businesses SET industrial_area_id = ${area.id}, industrial_area_other = NULL, updated_at = now()
        WHERE industrial_area_other IS NOT NULL AND ${sameText}
          AND pincode IN (
            SELECT pd.pincode
            FROM ${pincodeDistrictSql(sql`SELECT pincode FROM businesses WHERE industrial_area_other IS NOT NULL AND ${sameText}`)} AS pd
            WHERE lower(pd.district) = lower(${input.district}) AND pd.state = ${input.state}
          )
        RETURNING id
      `);

      await writeAudit(tx, {
        adminId,
        action: 'industrial_area.adopt',
        entityType: 'industrial_area',
        entityId: area.id,
        before: { text: input.text, district: input.district, state: input.state },
        after: { area, linked: linked.length, businessIds: linked.map((r) => r.id) },
      });
      return { areaId: area.id, linked: linked.length };
    }),
  );
}
