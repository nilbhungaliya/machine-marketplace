import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { partRequestWork } from '../src/db/schema.js';
import { createTestBrand, deleteTestBrands } from './_helpers/test-catalog.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import {
  countF8Rows,
  createTestPartTree,
  deleteF8Rows,
  insertTestFeedback,
  insertTestMatch,
  insertTestPartRequest,
  insertTestReply,
  insertTestTarget,
  type TestPartTree,
} from './_helpers/test-part-requests.js';

// F8 data model (spec 2026-11-20-f8-part-requests §5, §5.10; plan C0-2): what the database itself refuses. Raw SQL on
// purpose.

let tree: TestPartTree;
let seller: TestSeller;
let buyer: TestBusinessUser;
const sellers: TestSeller[] = [];
const businessIds: string[] = [];
const brandIds: string[] = [];

const exec = (q: ReturnType<typeof sql>) => db.execute(q);

async function newListing(): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: tree.partGroup.id,
  });
  return id;
}

const newRequest = (extra: Partial<Parameters<typeof insertTestPartRequest>[0]> = {}) =>
  insertTestPartRequest({
    businessId: buyer.businessId,
    userId: buyer.userId,
    categoryId: tree.partGroup.id,
    unitId: tree.unitId,
    side: 'left',
    ...extra,
  });

beforeAll(async () => {
  tree = await createTestPartTree();
  seller = await createTestSeller({ machineCategoryId: tree.machineCategory.id });
  buyer = await createTestBusinessUser();
  sellers.push(seller);
  businessIds.push(seller.businessId, buyer.businessId);
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras(sellers);
  await deleteTestBrands(brandIds);
  await tree.cleanup();
});

describe('F8 schema', () => {
  it('keeps one unclaimed work row per kind and subject, and allows a new one once it is claimed', async () => {
    const listingId = await newListing();
    const insert = () =>
      exec(sql`INSERT INTO part_request_work (kind, subject_id) VALUES ('listing_changed', ${listingId})`);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505', constraint: 'part_request_work_unclaimed_uq' });
    await db.update(partRequestWork).set({ claimedAt: sql`now()` }).where(eq(partRequestWork.subjectId, listingId));
    await expect(insert()).resolves.toBeTruthy();
  });

  it('refuses a second reply for the same request and listing', async () => {
    const request = await newRequest();
    const listingId = await newListing();
    const reply = { partRequestId: request.id, sellerBusinessId: seller.businessId, listingId, userId: seller.userId };
    await insertTestReply(reply);
    await expect(insertTestReply({ ...reply, status: 'pending' })).rejects.toMatchObject({
      code: '23505', constraint: 'part_request_replies_request_listing_uq',
    });
  });

  it('keeps one unread grouped row per user, request and type', async () => {
    const request = await newRequest();
    const insert = (type: string, key: string) =>
      exec(sql`
        INSERT INTO notifications (user_id, business_id, type, category, part_request_id, dedupe_key)
        VALUES (${buyer.userId}, ${buyer.businessId}, ${type}, 'requests', ${request.id}, ${key})`);
    await insert('part_match', `part_match:${request.id}:1`);
    await expect(insert('part_match', `part_match:${request.id}:2`)).rejects.toMatchObject({
      code: '23505', constraint: 'notifications_open_request_row',
    });
    await expect(insert('part_request_reply', `part_request_reply:${request.id}:1`)).resolves.toBeTruthy();
    await exec(sql`UPDATE notifications SET read_at = now() WHERE part_request_id = ${request.id} AND type = 'part_match'`);
    await expect(insert('part_match', `part_match:${request.id}:3`)).resolves.toBeTruthy();
  });

  it('refuses a machine request with a side or part number', async () => {
    await expect(newRequest({ kind: 'machine', categoryId: tree.machineType.id })).resolves.toBeTruthy();
    const machine = await newRequest({ kind: 'machine', categoryId: tree.machineType.id });
    await expect(exec(sql`UPDATE part_requests SET side = 'left' WHERE id = ${machine.id}`)).rejects.toMatchObject({
      code: '23514', constraint: 'part_requests_machine_shape',
    });
    await expect(exec(sql`UPDATE part_requests SET part_number = 'AB123' WHERE id = ${machine.id}`)).rejects.toMatchObject({
      code: '23514', constraint: 'part_requests_machine_shape',
    });
  });

  it('refuses closed without a reason, more than 3 photos, a 301-character reply message', async () => {
    const request = await newRequest();
    await expect(exec(sql`UPDATE part_requests SET status = 'closed' WHERE id = ${request.id}`)).rejects.toMatchObject({
      code: '23514', constraint: 'part_requests_closed_reason',
    });
    await expect(
      exec(sql`UPDATE part_requests SET photo_keys = ARRAY['a', 'b', 'c', 'd'] WHERE id = ${request.id}`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'part_requests_photos_max' });
    const listingId = await newListing();
    await expect(
      insertTestReply({
        partRequestId: request.id, sellerBusinessId: seller.businessId, listingId, userId: seller.userId, message: 'x'.repeat(301),
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'part_request_replies_message_len' });
  });

  it('starts references at 300001 and has the new enum values', async () => {
    const request = await newRequest();
    expect(request.ref).toBeGreaterThanOrEqual(300001);
    const { rows } = await exec(sql`
      SELECT 'part_request' = ANY(enum_range(NULL::report_target)::text[]) AS report,
             'requests' = ANY(enum_range(NULL::notification_category)::text[]) AS category`);
    expect(rows[0]).toEqual({ report: true, category: true });
  });

  it('deleteF8Rows leaves no F8 row behind, and the businesses then delete', async () => {
    const other = await createTestSeller({ machineCategoryId: tree.machineCategory.id });
    sellers.push(other);
    const brand = await createTestBrand();
    brandIds.push(brand.id);
    const request = await newRequest({ fits: [{ brandId: brand.id, yearFrom: 2010, yearTo: 2015 }] });
    const listingId = await newListing();
    await insertTestReply({ partRequestId: request.id, sellerBusinessId: seller.businessId, listingId, userId: seller.userId });
    await insertTestMatch({ partRequestId: request.id, listingId, sellerBusinessId: seller.businessId });
    await insertTestTarget({ partRequestId: request.id, businessId: other.businessId, bestListingId: listingId });
    await insertTestFeedback({ partRequestId: request.id, businessId: other.businessId, userId: other.userId });
    await exec(sql`INSERT INTO part_request_work (kind, subject_id) VALUES ('target_request', ${request.id})`);
    await exec(sql`INSERT INTO part_request_push_counts (business_id, day, pushes) VALUES (${other.businessId}, current_date, 1)`);
    await exec(sql`
      INSERT INTO notifications (user_id, business_id, type, category, part_request_id, dedupe_key)
      VALUES (${other.userId}, ${other.businessId}, 'part_request_new', 'requests', ${request.id}, ${`part_request_new:${request.id}`})`);
    await exec(sql`
      INSERT INTO reports (target_type, target_id, reporter_business_id, reporter_user_id, reason)
      VALUES ('part_request', ${request.id}, ${other.businessId}, ${other.userId}, 'spam')`);

    await deleteF8Rows(db, { businessIds: [...businessIds, other.businessId] });
    const counts = await countF8Rows();
    expect(Object.values(counts).every((n) => n === 0), JSON.stringify(counts)).toBe(true);
    await expect(deleteTestBusinesses([...businessIds, other.businessId])).resolves.toBeUndefined();
    businessIds.length = 0;
  });
});
