import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { deleteTestBrands, deleteTestCatalog, createTestBrand, createTestCatalog, type TestBrand, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestUsers } from './_helpers/test-users.js';
import {
  createTestSeller,
  deleteTestSellerExtras,
  insertTestHistory,
  insertTestListing,
  type TestSeller,
} from './_helpers/test-listings.js';

// F2 data model (spec 2026-11-18-f2-f3 §13): the constraints the services rely on. Raw SQL on purpose: these tests
// check what the database itself refuses, whatever the service layer does.

let catalog: TestCatalog;
let brand: TestBrand;
let seller: TestSeller;
let reporter: TestSeller;
const sellers: TestSeller[] = [];
let areaId = '';

async function rowsOf<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

async function countListingsOf(businessId: string): Promise<number> {
  const [row] = await rowsOf<{ n: number }>(sql`SELECT count(*)::int AS n FROM listings WHERE business_id = ${businessId}`);
  return row!.n;
}

beforeAll(async () => {
  catalog = await createTestCatalog();
  brand = await createTestBrand();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  reporter = await createTestSeller({ machineCategoryId: catalog.categoryId });
  sellers.push(seller, reporter);
  const [area] = await rowsOf<{ id: string }>(
    sql`INSERT INTO industrial_areas (name, city, state) VALUES (${`F2 Schema Estate ${catalog.suffix}`}, 'Surat', 'Gujarat') RETURNING id`,
  );
  areaId = area!.id;
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  if (areaId) await db.execute(sql`DELETE FROM industrial_areas WHERE id = ${areaId}`);
  await deleteTestBrands([brand.id]);
  await deleteTestCatalog(catalog.categoryId);
});

describe('F2 schema', () => {
  it('refuses a listing with both an industrial area and an "Other" text', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO listings (business_id, created_by_user_id, kind, industrial_area_id, industrial_area_other)
        VALUES (${seller.businessId}, ${seller.userId}, 'part', ${areaId}, 'Somewhere')`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'listings_area_one_of' });
  });

  // F6 + F7 §5.7 relaxed the CHECK to `>= 0` so a sell-out can store 0; input still refuses 0 (routes, go-live gate).
  it('refuses a negative quantity', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO listings (business_id, created_by_user_id, kind, quantity)
        VALUES (${seller.businessId}, ${seller.userId}, 'part', -1)`),
    ).rejects.toMatchObject({
      code: '23514',
      // -1 also breaks 0 ≤ held_quantity ≤ quantity; either CHECK may be the one reported.
      constraint: expect.stringMatching(/^listings_(quantity_positive|held_quantity_range)$/),
    });
  });

  it('refuses a fitment row whose years run backwards', async () => {
    const { id } = await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId });
    await expect(
      db.execute(sql`
        INSERT INTO listing_fitments (listing_id, brand_id, year_from, year_to)
        VALUES (${id}, ${brand.id}, 2020, 2010)`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'listing_fitments_years_order' });
  });

  it('refuses a machine with both a catalogue make and an "Other" make', async () => {
    const { id } = await insertTestListing(db, {
      businessId: seller.businessId, userId: seller.userId, kind: 'machine', categoryId: catalog.machineTypeId, machine: false,
    });
    await expect(
      db.execute(sql`
        INSERT INTO listing_machines (listing_id, brand_id, brand_other) VALUES (${id}, ${brand.id}, 'Other make')`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'listing_machines_brand_one_of' });
  });

  it('numbers listings from 100001', async () => {
    const { ref } = await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId });
    expect(ref).toBeGreaterThanOrEqual(100001);
  });

  it('allows one open report per business and target, and a new one after it is resolved', async () => {
    const { id } = await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId });
    const insertReport = () =>
      db.execute(sql`
        INSERT INTO reports (target_type, target_id, reporter_user_id, reporter_business_id, reason)
        VALUES ('listing', ${id}, ${reporter.userId}, ${reporter.businessId}, 'already_sold')`);
    await insertReport();
    await expect(insertReport()).rejects.toMatchObject({ code: '23505', constraint: 'reports_one_open_uq' });
    await db.execute(sql`UPDATE reports SET status = 'dismissed', resolved_at = now() WHERE target_id = ${id}`);
    await expect(insertReport()).resolves.toBeDefined();
  });

  it('indexes users.business_id', async () => {
    const rows = await rowsOf<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_business_id_idx'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('defaults units.is_machine_unit to false', async () => {
    const [row] = await rowsOf<{ is_machine_unit: boolean }>(sql`SELECT is_machine_unit FROM units WHERE id = ${catalog.unitId}`);
    expect(row!.is_machine_unit).toBe(false);
  });

  it('deleteTestBusinesses removes the listings and every child first', async () => {
    const other = await createTestSeller({ machineCategoryId: catalog.categoryId });
    sellers.push(other);
    const listing = await insertTestListing(db, {
      businessId: other.businessId, userId: other.userId, kind: 'part', categoryId: catalog.partGroupId, side: 'left',
      partNumber: 'TP-200L', photos: 2, fitments: [{ brandId: brand.id, yearFrom: 2010, yearTo: 2020 }],
    });
    await insertTestListing(db, {
      businessId: other.businessId, userId: other.userId, kind: 'machine_rental', categoryId: catalog.machineTypeId,
    });
    await insertTestHistory(db, { listingId: listing.id, from: 'draft', to: 'live', action: 'publish', actor: 'seller', userId: other.userId });
    await db.execute(sql`
      INSERT INTO reports (target_type, target_id, reporter_user_id, reporter_business_id, reason)
      VALUES ('listing', ${listing.id}, ${reporter.userId}, ${reporter.businessId}, 'stock_photos')`);
    expect(await countListingsOf(other.businessId)).toBe(2);
    await deleteTestBusinesses([other.businessId]);
    expect(await countListingsOf(other.businessId)).toBe(0);
    const [reports] = await rowsOf<{ n: number }>(sql`SELECT count(*)::int AS n FROM reports WHERE target_id = ${listing.id}`);
    expect(reports!.n).toBe(0);
  });

  it('deleteTestUsers removes the users’ listings first', async () => {
    const other = await createTestSeller({ machineCategoryId: catalog.categoryId });
    sellers.push(other);
    await insertTestListing(db, {
      businessId: other.businessId, userId: other.userId, kind: 'machine', categoryId: catalog.machineTypeId, photos: 1,
      fitments: [],
    });
    expect(await countListingsOf(other.businessId)).toBe(1);
    await deleteTestUsers([other.userId]);
    expect(await countListingsOf(other.businessId)).toBe(0);
  });
});
