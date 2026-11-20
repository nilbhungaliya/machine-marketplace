import { sql } from 'drizzle-orm';
import type { DashboardOptions } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';

// The dashboard's filter choices (admin close-out §6.3; plan A1-2).

type Conn = Db | Tx;

export const DASHBOARD_OPTION_CITIES = 50;

/**
 * `GET /admin/dashboard/options`: the top 50 listing cities by active listings (case-insensitive, one spelling each),
 * the active industrial areas and the machine categories (catalogue roots, active).
 */
export async function dashboardOptions(conn: Conn): Promise<DashboardOptions> {
  const [cities, areas, roots] = await Promise.all([
    conn.execute<{ city: string }>(sql`
      SELECT min(l.city) AS city FROM listings l
      WHERE l.status IN ('live', 'reserved', 'rented') AND btrim(COALESCE(l.city, '')) <> ''
      GROUP BY lower(l.city)
      ORDER BY count(*) DESC, lower(l.city)
      LIMIT ${DASHBOARD_OPTION_CITIES}
    `),
    conn.execute<{ id: string; name: string; city: string }>(sql`
      SELECT ia.id, ia.name, ia.city FROM industrial_areas ia WHERE ia.is_active
      ORDER BY ia.city, ia.sort_order, ia.name, ia.id
    `),
    conn.execute<{ id: string; name: string }>(sql`
      SELECT c.id, c.name FROM categories c WHERE c.parent_id IS NULL AND c.is_active
      ORDER BY c.sort_order, c.name, c.id
    `),
  ]);
  return {
    cities: cities.rows.map((r) => r.city),
    industrialAreas: areas.rows.map((r) => ({ id: r.id, name: r.name, city: r.city })),
    categories: roots.rows.map((r) => ({ id: r.id, name: r.name })),
  };
}
