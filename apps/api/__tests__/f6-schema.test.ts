import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { deleteTestListings } from './_helpers/test-users.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { deleteF6Rows, insertTestDeal, insertTestOffer, insertTestThread } from './_helpers/test-deals.js';

// F6 + F7 data model (spec 2026-11-19-f6-f7 §5, §5.17; plan C0-2): what the database itself refuses. Raw SQL on purpose.

let catalog: TestCatalog;
let seller: TestSeller;
let buyer: TestBusinessUser;
const sellers: TestSeller[] = [];
const businessIds: string[] = [];

async function rowsOf<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

async function newListing(quantity = '10'): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: catalog.partGroupId,
    quantity,
    priceModel: 'negotiable',
    pricePaise: 100_000,
  });
  return id;
}

beforeAll(async () => {
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  buyer = await createTestBusinessUser();
  sellers.push(seller);
  businessIds.push(seller.businessId, buyer.businessId);
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras(sellers);
  await deleteTestCatalog(catalog.categoryId);
});

describe('F6 schema', () => {
  it('allows one open offer per thread, and a new one after it is accepted', async () => {
    const listingId = await newListing();
    const thread = await insertTestThread({ listingId, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    const first = await insertTestOffer({ threadId: thread.id, pricePerUnitPaise: 90_000, quantity: '1' });
    await expect(insertTestOffer({ threadId: thread.id, pricePerUnitPaise: 80_000, quantity: '1' })).rejects.toMatchObject({
      code: '23505', constraint: 'offers_one_open_per_thread',
    });
    await db.execute(sql`UPDATE offers SET status = 'accepted' WHERE id = ${first.id}`);
    await expect(insertTestOffer({ threadId: thread.id, pricePerUnitPaise: 80_000, quantity: '1' })).resolves.toBeTruthy();
  });

  it('refuses a second thread for the same listing and buyer', async () => {
    const listingId = await newListing();
    await insertTestThread({ listingId, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    await expect(insertTestThread({ listingId, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId })).rejects.toMatchObject({
      code: '23505', constraint: 'chat_threads_listing_buyer_uq',
    });
  });

  it('keeps one unread grouped chat row per user and thread', async () => {
    const listingId = await newListing();
    const thread = await insertTestThread({ listingId, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    const insert = (key: string) =>
      db.execute(sql`
        INSERT INTO notifications (user_id, business_id, type, category, thread_id, dedupe_key)
        VALUES (${seller.userId}, ${seller.businessId}, 'message_new', 'chat', ${thread.id}, ${key})`);
    await insert(`message_new:${thread.id}:1`);
    await expect(insert(`message_new:${thread.id}:2`)).rejects.toMatchObject({ code: '23505', constraint: 'notifications_open_chat_row' });
    await db.execute(sql`UPDATE notifications SET read_at = now() WHERE thread_id = ${thread.id}`);
    await expect(insert(`message_new:${thread.id}:3`)).resolves.toBeTruthy();
  });

  it('allows one open dispute per deal', async () => {
    const listingId = await newListing();
    const deal = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '1', pricePerUnitPaise: 100_000, status: 'disputed' });
    const insert = () =>
      db.execute(sql`
        INSERT INTO deal_disputes (deal_id, opened_by_side, opened_by_user_id, category, description)
        VALUES (${deal.dealId}, 'buyer', ${buyer.userId}, 'damaged', 'Arrived with a cracked housing')`);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505', constraint: 'deal_disputes_one_open_deal' });
  });

  it('numbers deals from 500001 and refuses an advance above the total', async () => {
    const listingId = await newListing();
    const deal = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '2', pricePerUnitPaise: 100_000 });
    expect(deal.ref).toBeGreaterThanOrEqual(500001);
    await expect(db.execute(sql`UPDATE deals SET advance_paise = total_paise + 1 WHERE id = ${deal.dealId}`)).rejects.toMatchObject({
      code: '23514',
      constraint: 'deals_advance_le_total',
    });
  });

  it('refuses a text message with an offer, six photos and a seller review with text', async () => {
    const listingId = await newListing();
    const deal = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '1', pricePerUnitPaise: 100_000, status: 'completed' });
    await expect(
      db.execute(sql`
        INSERT INTO chat_messages (thread_id, kind, sender_side, sender_user_id, text, offer_id)
        VALUES (${deal.threadId}, 'text', 'buyer', ${buyer.userId}, 'hello', ${deal.offerId})`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'chat_messages_shape' });
    await expect(
      db.execute(sql`
        INSERT INTO chat_messages (thread_id, kind, sender_side, sender_user_id, photo_keys)
        VALUES (${deal.threadId}, 'photos', 'buyer', ${buyer.userId}, ARRAY['a','b','c','d','e','f'])`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'chat_messages_photos_max' });
    await expect(
      db.execute(sql`
        INSERT INTO deal_reviews (deal_id, reviewer_side, reviewer_business_id, reviewed_business_id, reviewer_user_id,
          r_communication, r_payment, r_pickup, text, publish_due_at)
        VALUES (${deal.dealId}, 'seller', ${seller.businessId}, ${buyer.businessId}, ${seller.userId}, 5, 5, 5, 'Great buyer', now())`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'deal_reviews_shape' });
  });

  it('keeps held_quantity between 0 and quantity, and lets quantity reach 0 but not below', async () => {
    const listingId = await newListing('3');
    await expect(db.execute(sql`UPDATE listings SET held_quantity = 4 WHERE id = ${listingId}`)).rejects.toMatchObject({
      code: '23514',
      constraint: 'listings_held_quantity_range',
    });
    await expect(db.execute(sql`UPDATE listings SET held_quantity = -1 WHERE id = ${listingId}`)).rejects.toMatchObject({
      code: '23514',
      constraint: 'listings_held_quantity_range',
    });
    await expect(db.execute(sql`UPDATE listings SET quantity = 0 WHERE id = ${listingId}`)).resolves.toBeTruthy();
    await expect(db.execute(sql`UPDATE listings SET quantity = -1 WHERE id = ${listingId}`)).rejects.toMatchObject({
      code: '23514',
      // -1 also breaks 0 ≤ held_quantity ≤ quantity; either CHECK may be the one reported.
      constraint: expect.stringMatching(/^listings_(quantity_positive|held_quantity_range)$/),
    });
  });

  it('keeps consents append-only unless the purge setting is on', async () => {
    const [c] = await rowsOf<{ id: string }>(sql`
      INSERT INTO contact_share_consents (kind, business_id, user_id, phone_shown, phone_source, wording_version)
      VALUES ('grant', ${buyer.businessId}, ${buyer.userId}, ${buyer.phone}, 'owner_phone', 1) RETURNING id`);
    await expect(db.execute(sql`UPDATE contact_share_consents SET wording_version = 2 WHERE id = ${c!.id}`)).rejects.toMatchObject({
      message: expect.stringContaining('append-only'),
    });
    await expect(db.execute(sql`DELETE FROM contact_share_consents WHERE id = ${c!.id}`)).rejects.toMatchObject({
      message: expect.stringContaining('append-only'),
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL mpm.consent_purge = 'on'`);
      await tx.execute(sql`DELETE FROM contact_share_consents WHERE id = ${c!.id}`);
    });
    expect(await rowsOf(sql`SELECT 1 FROM contact_share_consents WHERE id = ${c!.id}`)).toHaveLength(0);
  });

  it("has the report target 'review'", async () => {
    const rows = await rowsOf<{ v: string }>(sql`SELECT unnest(enum_range(NULL::report_target))::text AS v`);
    expect(rows.map((r) => r.v)).toContain('review');
  });

  it('deleteF6Rows leaves nothing behind, and the listing can then be deleted', async () => {
    const s2 = await createTestSeller({ machineCategoryId: catalog.categoryId });
    const b2 = await createTestBusinessUser();
    sellers.push(s2);
    businessIds.push(s2.businessId, b2.businessId);
    const { id: listingId } = await insertTestListing(db, {
      businessId: s2.businessId, userId: s2.userId, kind: 'part', categoryId: catalog.partGroupId, quantity: '5',
    });
    const deal = await insertTestDeal({ listing: { id: listingId }, buyer: b2, quantity: '1', pricePerUnitPaise: 100_000, status: 'completed' });
    const t = deal.threadId;
    await db.execute(sql`INSERT INTO chat_messages (thread_id, kind, sender_side, sender_user_id, text) VALUES (${t}, 'text', 'buyer', ${b2.userId}, 'hi')`);
    await db.execute(sql`INSERT INTO chat_thread_user_state (thread_id, user_id) VALUES (${t}, ${b2.userId})`);
    await db.execute(sql`INSERT INTO business_blocks (blocker_business_id, blocked_business_id, created_by_user_id) VALUES (${b2.businessId}, ${s2.businessId}, ${b2.userId})`);
    await db.execute(sql`
      INSERT INTO contact_share_consents (kind, thread_id, business_id, user_id, phone_shown, phone_source, wording_version)
      VALUES ('grant', ${t}, ${b2.businessId}, ${b2.userId}, ${b2.phone}, 'owner_phone', 1)`);
    await db.execute(sql`INSERT INTO deal_events (deal_id, code, actor_side) VALUES (${deal.dealId}, 'agreed', 'system')`);
    await db.execute(sql`
      INSERT INTO deal_disputes (deal_id, opened_by_side, opened_by_user_id, category, description, status, outcome)
      VALUES (${deal.dealId}, 'buyer', ${b2.userId}, 'other', 'Something was wrong', 'resolved', 'completed')`);
    const [review] = await rowsOf<{ id: string }>(sql`
      INSERT INTO deal_reviews (deal_id, reviewer_side, reviewer_business_id, reviewed_business_id, reviewer_user_id,
        r_matched_listing, r_communication, r_on_time, publish_due_at)
      VALUES (${deal.dealId}, 'buyer', ${b2.businessId}, ${s2.businessId}, ${b2.userId}, 5, 4, 5, now()) RETURNING id`);
    const [device] = await rowsOf<{ id: string }>(sql`
      INSERT INTO user_devices (user_id, install_id, fcm_token, platform) VALUES (${s2.userId}, ${`install-${t}`}, 'tok', 'android') RETURNING id`);
    const [n] = await rowsOf<{ id: string }>(sql`
      INSERT INTO notifications (user_id, business_id, type, category, review_id, dedupe_key)
      VALUES (${s2.userId}, ${s2.businessId}, 'review_received', 'reviews', ${review!.id}, ${`review_received:${review!.id}`}) RETURNING id`);
    await db.execute(sql`INSERT INTO notification_deliveries (notification_id, version, device_id) VALUES (${n!.id}, 1, ${device!.id})`);
    await db.execute(sql`
      INSERT INTO reports (target_type, target_id, reporter_user_id, reporter_business_id, reason)
      VALUES ('conversation', ${t}, ${s2.userId}, ${s2.businessId}, 'spam')`);
    await db.execute(sql`
      INSERT INTO idempotency_keys (scope, key, request_hash, status_code, response)
      VALUES (${`POST /offers/:id/accept:${b2.userId}`}, 'k1', 'h', 200, '{}'::jsonb)`);

    await deleteF6Rows(db, { businessIds: [s2.businessId, b2.businessId], userIds: [s2.userId, b2.userId] });

    const [left] = await rowsOf<{ n: number }>(sql`
      SELECT (SELECT count(*) FROM chat_threads WHERE id = ${t})
           + (SELECT count(*) FROM chat_messages WHERE thread_id = ${t})
           + (SELECT count(*) FROM chat_thread_user_state WHERE thread_id = ${t})
           + (SELECT count(*) FROM business_blocks WHERE blocker_business_id = ${b2.businessId})
           + (SELECT count(*) FROM contact_share_consents WHERE business_id = ${b2.businessId})
           + (SELECT count(*) FROM offers WHERE thread_id = ${t})
           + (SELECT count(*) FROM deals WHERE id = ${deal.dealId})
           + (SELECT count(*) FROM stock_holds WHERE listing_id = ${listingId})
           + (SELECT count(*) FROM deal_events WHERE deal_id = ${deal.dealId})
           + (SELECT count(*) FROM deal_disputes WHERE deal_id = ${deal.dealId})
           + (SELECT count(*) FROM deal_reviews WHERE deal_id = ${deal.dealId})
           + (SELECT count(*) FROM notifications WHERE id = ${n!.id})
           + (SELECT count(*) FROM notification_deliveries WHERE notification_id = ${n!.id})
           + (SELECT count(*) FROM user_devices WHERE id = ${device!.id})
           + (SELECT count(*) FROM reports WHERE target_id = ${t})
           + (SELECT count(*) FROM idempotency_keys WHERE scope LIKE ${`%:${b2.userId}`}) AS n`);
    expect(Number(left!.n)).toBe(0);
    await expect(deleteTestListings(db, [listingId])).resolves.toBeUndefined();
  });
});
