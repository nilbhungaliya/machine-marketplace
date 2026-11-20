import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { insertTestThread } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { countCloseOutRows, deleteCloseOutRows, insertTestMessage, insertTestSighting } from './_helpers/test-fraud.js';

// Admin close-out data model (spec 2026-11-21-admin-close-out §5; plan C0-2): what the database itself refuses, and
// the cleanup helpers leaving nothing behind. Raw SQL on purpose.

let seller: TestSeller;
let buyer: TestBusinessUser;
let threadId: string;
const businessIds: string[] = [];

const evidence = (n: number) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ key: `report:${i}`, at: new Date().toISOString(), summary: 's', refs: {} })));

const insertSignal = (o: { status?: string; reviewed?: boolean; evidence?: string } = {}) =>
  db.execute(sql`
    INSERT INTO fraud_signals (business_id, kind, status, evidence, evidence_count, first_seen_at, last_seen_at, reviewed_at)
    VALUES (${seller.businessId}, 'payment_details', ${o.status ?? 'open'}::fraud_signal_status,
      ${o.evidence ?? '[]'}::jsonb, 0, now(), now(), ${o.reviewed ? sql`now()` : sql`NULL`})
    RETURNING id`);

beforeAll(async () => {
  seller = await createTestSeller();
  buyer = await createTestBusinessUser();
  businessIds.push(seller.businessId, buyer.businessId);
  const listing = await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null });
  threadId = (await insertTestThread({ listingId: listing.id, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId })).id;
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras([seller]);
});

describe('admin close-out schema', () => {
  it('one open signal per business and kind; another once the first is reviewed', async () => {
    const first = (await insertSignal()).rows[0] as { id: string };
    await expect(insertSignal()).rejects.toMatchObject({ code: '23505', constraint: 'fraud_signals_one_open' });
    await db.execute(sql`UPDATE fraud_signals SET status = 'dismissed', reviewed_at = now() WHERE id = ${first.id}`);
    await expect(insertSignal()).resolves.toBeDefined();
  });

  it('an open signal has no reviewed_at, a closed one has it', async () => {
    await expect(insertSignal({ status: 'open', reviewed: true })).rejects.toMatchObject({
      code: '23514', constraint: 'fraud_signals_review_shape',
    });
    await expect(insertSignal({ status: 'actioned', reviewed: false })).rejects.toMatchObject({
      code: '23514', constraint: 'fraud_signals_review_shape',
    });
  });

  it('evidence is an array of at most 50 items', async () => {
    await expect(insertSignal({ status: 'dismissed', reviewed: true, evidence: evidence(51) })).rejects.toMatchObject({
      code: '23514', constraint: 'fraud_signals_evidence_shape',
    });
    await expect(insertSignal({ status: 'dismissed', reviewed: true, evidence: '{}' })).rejects.toMatchObject({
      code: '23514', constraint: 'fraud_signals_evidence_shape',
    });
    await expect(insertSignal({ status: 'dismissed', reviewed: true, evidence: evidence(50) })).resolves.toBeDefined();
  });

  it('a scan-state row holds exactly one watermark', async () => {
    const rule = `test-${randomUUID()}`;
    try {
      await expect(
        db.execute(sql`INSERT INTO fraud_scan_state (rule, last_seq, last_at) VALUES (${rule}, 1, now())`),
      ).rejects.toMatchObject({ code: '23514', constraint: 'fraud_scan_state_one_mark' });
      await expect(
        db.execute(sql`INSERT INTO fraud_scan_state (rule) VALUES (${rule})`),
      ).rejects.toMatchObject({ code: '23514', constraint: 'fraud_scan_state_one_mark' });
      await expect(db.execute(sql`INSERT INTO fraud_scan_state (rule, last_seq) VALUES (${rule}, 1)`)).resolves.toBeDefined();
    } finally {
      await db.execute(sql`DELETE FROM fraud_scan_state WHERE rule = ${rule}`);
    }
  });

  it('a message and phone HMAC are sighted once', async () => {
    const msg = await insertTestMessage({ threadId, senderUserId: buyer.userId, senderSide: 'buyer', text: 'call me' });
    const insert = () =>
      db.execute(sql`
        INSERT INTO contact_sightings (phone_hmac, business_id, thread_id, message_id, seen_at)
        VALUES ('aa11', ${buyer.businessId}, ${threadId}, ${msg.id}, now())`);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505', constraint: 'contact_sightings_message_phone_uq' });
  });

  it('deleteCloseOutRows leaves nothing, then the businesses delete', async () => {
    await insertTestSighting({ installId: randomUUID(), userId: buyer.userId });
    await insertTestSighting({ installId: randomUUID(), userId: seller.userId });
    const scope = { businessIds, userIds: [buyer.userId, seller.userId] };
    const before = await countCloseOutRows(db, scope);
    expect(before.fraudSignals).toBeGreaterThan(0);
    expect(before.contactSightings).toBe(1);
    expect(before.installSightings).toBe(2);
    await deleteCloseOutRows(db, scope);
    expect(await countCloseOutRows(db, scope)).toEqual({ fraudSignals: 0, contactSightings: 0, installSightings: 0 });
    // Rows again, so the usual cleanup has to clear them itself.
    await insertSignal();
    await insertTestSighting({ installId: randomUUID(), userId: buyer.userId });
    await deleteTestBusinesses([...businessIds]);
    businessIds.length = 0;
    expect(await countCloseOutRows(db, scope)).toEqual({ fraudSignals: 0, contactSightings: 0, installSightings: 0 });
  });
});
