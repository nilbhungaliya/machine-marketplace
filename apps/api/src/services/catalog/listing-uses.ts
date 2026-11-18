import { inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/index.js';
import { listings } from '../../db/schema.js';

// The catalogue guards' listing checks (F2 spec §16, A4's "M5 adds the check" points). Every listing counts, drafts
// included. Callers hold a lock on the catalogue row first (FOR UPDATE), so a listing write that references it (FOR KEY
// SHARE through the foreign key) waits for the guard's transaction and can't slip in after the check.

const exists = async (conn: Db | Tx, query: ReturnType<typeof sql>): Promise<boolean> =>
  (await conn.execute(sql`SELECT EXISTS (${query}) AS used`)).rows[0]?.used === true;

/** Whether any listing sits on one of these category nodes. */
export async function listingsUseNodes(conn: Db | Tx, nodeIds: string[]): Promise<boolean> {
  if (nodeIds.length === 0) return false;
  const [row] = await conn.select({ id: listings.id }).from(listings).where(inArray(listings.categoryId, nodeIds)).limit(1);
  return row !== undefined;
}

/** Whether a listing uses the brand as part brand, machine make or fitment brand. */
export async function listingsUseBrand(conn: Db | Tx, brandId: string): Promise<boolean> {
  return exists(
    conn,
    sql`SELECT 1 FROM listings WHERE part_brand_id = ${brandId}
        UNION ALL SELECT 1 FROM listing_machines WHERE brand_id = ${brandId}
        UNION ALL SELECT 1 FROM listing_fitments WHERE brand_id = ${brandId}`,
  );
}

/** Whether a listing's machine model or a fitment row references the model. */
export async function listingsUseModel(conn: Db | Tx, modelId: string): Promise<boolean> {
  return exists(
    conn,
    sql`SELECT 1 FROM listing_machines WHERE model_id = ${modelId}
        UNION ALL SELECT 1 FROM listing_fitments WHERE model_id = ${modelId}`,
  );
}

/** Whether any listing uses the unit. */
export async function listingsUseUnit(conn: Db | Tx, unitId: string): Promise<boolean> {
  return exists(conn, sql`SELECT 1 FROM listings WHERE unit_id = ${unitId}`);
}

/** How many listings exist (any status). */
export async function countListings(conn: Db | Tx): Promise<number> {
  const [row] = await conn.select({ n: sql<number>`count(*)::int` }).from(listings);
  return row!.n;
}
