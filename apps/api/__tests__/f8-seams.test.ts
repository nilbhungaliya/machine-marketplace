import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { partRequestReplies, partRequestWork } from '../src/db/schema.js';
import * as storage from '../src/lib/storage.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { finalizePrivatePhotos } from '../src/services/chat/private-photo.js';
import { notify } from '../src/services/notifications/notify.js';
import { markRequestNotificationsRead, upsertRequestNotification } from '../src/services/notifications/request-rows.js';
import { dropPendingRepliesForRequest } from '../src/services/part-requests/reply-drops.js';
import { enqueueListingsChanged, enqueuePartRequestWork } from '../src/services/part-requests/work-queue.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { addTestMember } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import {
  createTestPartTree,
  insertTestPartRequest,
  insertTestReply,
  type TestPartRequestRow,
  type TestPartTree,
} from './_helpers/test-part-requests.js';

// The F8 seams the lanes build on (plan C0-3b): the work queue's unclaimed-only unique, in-app-only notify, the grouped
// request rows, pending-reply drops and the per-destination photo cap.

vi.mock('../src/lib/storage.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/storage.js')>();
  return { ...real, getObjectBytes: vi.fn(real.getObjectBytes) };
});
const bytesSpy = vi.mocked(storage.getObjectBytes);

let tree: TestPartTree;
let buyer: TestBusinessUser;
let viewer: { userId: string };
let seller: TestSeller;
let request: TestPartRequestRow;
const businessIds: string[] = [];

const emitted: Array<{ room: string; event: string }> = [];
const fakeIo = { of: () => ({ to: (room: string) => ({ emit: (event: string) => void emitted.push({ room, event }) }) }) };
const txApp = { db, io: fakeIo, log: { warn: () => undefined } } as unknown as TxApp;

const listing = async () =>
  (await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: tree.partGroup.id, side: 'left' })).id;

beforeAll(async () => {
  tree = await createTestPartTree();
  buyer = await createTestBusinessUser();
  seller = await createTestSeller({ machineCategoryId: tree.machineCategory.id });
  businessIds.push(buyer.businessId, seller.businessId);
  viewer = await addTestMember(buyer.businessId, 'viewer');
  await db.execute(sql`INSERT INTO user_devices (user_id, install_id, fcm_token, platform)
    VALUES (${buyer.userId}, ${`f8-${randomUUID()}`}, 'tok-f8', 'android')`);
  request = await insertTestPartRequest({
    businessId: buyer.businessId, userId: buyer.userId, categoryId: tree.machineType.id, unitId: tree.unitId, side: 'left',
  });
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras([seller]);
  await tree.cleanup();
});

describe('work queue', () => {
  it('collapses unclaimed rows; a claimed row held by the job neither blocks nor absorbs a new enqueue', async () => {
    const listingId = await listing();
    await db.transaction((tx) => enqueuePartRequestWork(tx, 'listing_changed', listingId));
    await db.transaction((tx) => enqueueListingsChanged(tx, [listingId, listingId]));
    const rows = await db.select().from(partRequestWork).where(eq(partRequestWork.subjectId, listingId));
    expect(rows).toHaveLength(1);
    await db.update(partRequestWork).set({ claimedAt: new Date() }).where(eq(partRequestWork.id, rows[0]!.id));

    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const held = new Promise<void>((r) => (release = r));
    const job = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM part_request_work WHERE id = ${rows[0]!.id} FOR UPDATE`);
      locked();
      await held;
    });
    await isLocked;
    const t0 = Date.now();
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
        await enqueuePartRequestWork(tx, 'listing_changed', listingId);
      });
      expect(Date.now() - t0).toBeLessThan(1000);
    } finally {
      release();
      await job;
    }
    expect(await db.select().from(partRequestWork).where(eq(partRequestWork.subjectId, listingId))).toHaveLength(2);
  });
});

describe('notify({ push: false })', () => {
  it('writes the rows with the request id and no deliveries', async () => {
    const dedupeKey = `part_request_expired:${request.id}`;
    const ids = await runTx(txApp, (tx) =>
      notify(tx, {
        type: 'part_request_expired', recipientBusinessId: buyer.businessId, params: { requestTitle: 'x' },
        destination: { partRequestId: request.id }, dedupeKey, push: false,
      }),
    );
    expect(ids).toHaveLength(2);
    const { rows } = await db.execute(sql`
      SELECT n.part_request_id, n.category, (SELECT count(*)::int FROM notification_deliveries d WHERE d.notification_id = n.id) AS d
      FROM notifications n WHERE n.dedupe_key = ${dedupeKey}`);
    expect(rows).toEqual([
      { part_request_id: request.id, category: 'requests', d: 0 },
      { part_request_id: request.id, category: 'requests', d: 0 },
    ]);
  });
});

describe('upsertRequestNotification', () => {
  const rowsOf = async (type: string) =>
    (
      await db.execute(sql`
        SELECT n.user_id, n.unread_count, n.version, n.read_at IS NOT NULL AS read, n.category,
               (SELECT count(*)::int FROM notification_deliveries d WHERE d.notification_id = n.id) AS deliveries,
               (SELECT max(d.version) FROM notification_deliveries d WHERE d.notification_id = n.id) AS last_delivery
        FROM notifications n WHERE n.part_request_id = ${request.id} AND n.type = ${type} ORDER BY n.created_at`)
    ).rows as Array<{ user_id: string; unread_count: number; version: number; read: boolean; category: string; deliveries: number; last_delivery: number | null }>;
  const event = (key: string, push: boolean) =>
    runTx(txApp, (tx) =>
      upsertRequestNotification(tx, {
        type: 'part_match', partRequestId: request.id, recipientBusinessId: buyer.businessId,
        params: { requestTitle: 'Temple roller' }, eventKey: key, push,
      }),
    );
  const owner = (rows: Awaited<ReturnType<typeof rowsOf>>) => rows.filter((r) => r.user_id === buyer.userId);

  it('groups events on one unread row per member; push bumps the version and queues a delivery; read starts over', async () => {
    const k1 = `part_match:${request.id}:${randomUUID()}`;
    emitted.length = 0;
    await event(k1, true);
    let rows = await rowsOf('part_match');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.unread_count === 1 && r.version === 1 && r.category === 'requests')).toBe(true);
    expect(owner(rows)[0]).toMatchObject({ deliveries: 1, last_delivery: 1 });
    expect(rows.find((r) => r.user_id === viewer.userId)!.deliveries).toBe(0);
    expect(emitted.filter((e) => e.event === 'notification:new')).toHaveLength(2);

    await event(`part_match:${request.id}:${randomUUID()}`, true);
    rows = await rowsOf('part_match');
    expect(owner(rows)[0]).toMatchObject({ unread_count: 2, version: 2, deliveries: 2, last_delivery: 2 });

    await event(`part_match:${request.id}:${randomUUID()}`, false);
    rows = await rowsOf('part_match');
    expect(owner(rows)[0]).toMatchObject({ unread_count: 3, version: 2, deliveries: 2 });

    await runTx(txApp, (tx) => markRequestNotificationsRead(tx, buyer.userId, request.id));
    expect(owner(await rowsOf('part_match'))).toEqual([expect.objectContaining({ read: true })]);
    await event(k1, true);
    expect(owner(await rowsOf('part_match'))).toHaveLength(1);

    await event(`part_match:${request.id}:${randomUUID()}`, true);
    rows = owner(await rowsOf('part_match'));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ unread_count: 1, version: 1, read: false });
  });
});

describe('dropPendingRepliesForRequest', () => {
  it('drops pending replies only and tells each seller once per reply', async () => {
    const r = await insertTestPartRequest({
      businessId: buyer.businessId, userId: buyer.userId, categoryId: tree.machineType.id, unitId: tree.unitId,
    });
    const pending = [
      await insertTestReply({ partRequestId: r.id, sellerBusinessId: seller.businessId, listingId: await listing(), userId: seller.userId, status: 'pending' }),
      await insertTestReply({ partRequestId: r.id, sellerBusinessId: seller.businessId, listingId: await listing(), userId: seller.userId, status: 'pending' }),
    ];
    const delivered = await insertTestReply({
      partRequestId: r.id, sellerBusinessId: seller.businessId, listingId: await listing(), userId: seller.userId, status: 'delivered',
    });
    expect(await runTx(txApp, (tx) => dropPendingRepliesForRequest(tx, r, 'request_closed'))).toBe(2);
    const replies = await db.select().from(partRequestReplies).where(eq(partRequestReplies.partRequestId, r.id));
    const byId = new Map(replies.map((x) => [x.id, x]));
    for (const p of pending) expect(byId.get(p.id)).toMatchObject({ status: 'dropped', dropReason: 'request_closed' });
    expect(byId.get(delivered.id)!.status).toBe('delivered');
    const { rows } = await db.execute(sql`
      SELECT dedupe_key FROM notifications WHERE type = 'part_request_reply_dropped' AND part_request_id = ${r.id} ORDER BY dedupe_key`);
    expect(rows.map((x) => (x as { dedupe_key: string }).dedupe_key)).toEqual(
      pending.map((p) => `part_request_reply_dropped:${p.id}`).sort(),
    );
    expect(await runTx(txApp, (tx) => dropPendingRepliesForRequest(tx, r, 'request_closed'))).toBe(0);
  });
});

describe('finalizePrivatePhotos per destination', () => {
  const keys = (n: number) => Array.from({ length: n }, () => `incoming-chat/${seller.businessId}/${randomUUID()}`);

  it('a request takes at most 3 (default or { max }), refused before any storage call; chat still allows 5', async () => {
    bytesSpy.mockClear();
    const dest = { kind: 'part_request' as const, partRequestId: request.id };
    await expect(finalizePrivatePhotos(seller.businessId, keys(4), dest, { max: 3 })).rejects.toMatchObject({
      code: 'TOO_MANY_PHOTOS', details: { max: 3 },
    });
    await expect(finalizePrivatePhotos(seller.businessId, keys(4), dest)).rejects.toMatchObject({ code: 'TOO_MANY_PHOTOS', details: { max: 3 } });
    expect(bytesSpy).not.toHaveBeenCalled();
    // Five chat keys pass the count; a foreign key then stops it at the shape check, still before storage.
    const five = [...keys(4), `incoming-chat/${buyer.businessId}/${randomUUID()}`];
    await expect(finalizePrivatePhotos(seller.businessId, five, { kind: 'chat', threadId: randomUUID() })).rejects.toMatchObject({
      code: 'PHOTO_KEY_INVALID',
    });
    expect(bytesSpy).not.toHaveBeenCalled();
  });
});
