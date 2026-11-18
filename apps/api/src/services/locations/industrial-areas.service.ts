import { and, asc, eq, sql } from 'drizzle-orm';
import type { IndustrialArea } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { industrialAreas } from '../../db/schema.js';
import { pincodeDistrict } from './pincode.service.js';

// Reading industrial areas for the app's picker (F1 spec §4.2). Admin writes live in industrial-area-admin.service.

export type IndustrialAreaRow = typeof industrialAreas.$inferSelect;

export function toIndustrialArea(row: IndustrialAreaRow): IndustrialArea {
  return { id: row.id, name: row.name, city: row.city, state: row.state, isActive: row.isActive, sortOrder: row.sortOrder };
}

/**
 * The active areas of the pincode's district and state (`pincodeDistrict`), keyed on the pincode rather than the
 * editable city text. City is matched case-insensitively, state exactly; by sort order, then name. `[]` for a pincode
 * the directory doesn't have (the app then offers only Other).
 */
export async function areasForPincode(conn: Db | Tx, pincode: string): Promise<IndustrialArea[]> {
  const where = await pincodeDistrict(conn, pincode);
  if (!where) return [];
  const rows = await conn
    .select()
    .from(industrialAreas)
    .where(
      and(
        eq(industrialAreas.isActive, true),
        sql`lower(${industrialAreas.city}) = lower(${where.city})`,
        eq(industrialAreas.state, where.state),
      ),
    )
    .orderBy(asc(industrialAreas.sortOrder), asc(industrialAreas.name));
  return rows.map(toIndustrialArea);
}
