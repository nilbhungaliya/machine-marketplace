import { inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/index.js';
import { listings } from '../../db/schema.js';

// The catalogue guards' listing checks (F2 spec §16, A4's "M5 adds the check" points). Every listing counts, drafts
// included.
//
// What protects what: each guard locks its catalogue row `FOR UPDATE` before it checks (moveCategory / deleteCategory
// the node's subtree, deleteBrand the brand, moveModel / deleteModel the model, updateUnit the unit). Listing writes
// (create and PATCH, `services/listings/listing-validate.service.ts`) read every category node, brand, model and unit
// they reference `FOR KEY SHARE` inside their transaction **before** validating it, which conflicts with `FOR UPDATE`:
// - a guard that locked first makes the write wait, and the write then validates the guard's result (a moved model of
//   another machine type → MODEL_INVALID; a unit with fewer decimals → UNIT_DECIMALS; a deleted brand → BRAND_INVALID);
// - a write that locked first makes the guard wait until it commits; the guard's check, a new statement under READ
//   COMMITTED, then sees the new listing row and refuses.
// The foreign keys' own `FOR KEY SHARE` alone wouldn't do: it is taken at the INSERT / UPDATE, after the write has
// validated against the row as it was before the guard committed.

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
