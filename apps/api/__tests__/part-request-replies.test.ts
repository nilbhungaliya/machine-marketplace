import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  appSettings,
  businessBlocks,
  listingFitments,
  listingMachines,
  listings,
  machineModels,
  partRequestReplies,
  partRequests,
  users,
} from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { writeRequestStatus } from '../src/services/part-requests/lifecycle.js';
import { processListingChanged } from '../src/services/part-requests/reply-delivery.js';
import { dropPendingRepliesForRequest } from '../src/services/part-requests/reply-drops.js';
import { runPartRequestWork } from '../src/services/part-requests/work-job.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBrand, deleteTestBrands } from './_helpers/test-catalog.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { addTestMember } from './_helpers/test-deals.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestListing,
  type TestListingOptions,
  type TestSeller,
} from './_helpers/test-listings.js';
import { setTestSettings } from './_helpers/test-offers.js';
import {
  countF8Rows,
  createTestPartTree,
  insertTestPartRequest,
  insertTestReply,
  type TestPartRequestOptions,
  type TestPartRequestRow,
  type TestPartTree,
} from './_helpers/test-part-requests.js';

// Replies (plan A2-4, spec §9.2, §9.3, review Q3–Q5, Q7): send with its caps, fit reasons and races; withdraw;
// `POST /listings { kind, partRequestId }` prefill and its all-or-nothing checks; pending-reply delivery and every drop
// reason through the work job.

const SURAT = { lat: 21.17, lng: 72.83 };
const noop = () => undefined;
const txApp = { db, log: { error: noop, warn: noop, info: noop } } as unknown as TxApp;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let app: FastifyInstance;
let t: TestPartTree;
let otherTree: TestPartTree;
let buyer: TestBusinessUser;
let admin: { id: string; token: string };
let machineUnit: { id: string };
let brand: { id: string };
let modelA: string;
let modelB: string;
const sellers: TestSeller[] = [];
const businessIds: string[] = [];

async function newSeller(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: t.machineCategory.id, ...opts });
  sellers.push(s);
  businessIds.push(s.businessId);
  return s;
}

const request = (extra: Partial<TestPartRequestOptions> = {}) =>
  insertTestPartRequest({
    businessId: buyer.businessId, userId: buyer.userId, categoryId: t.machineType.id, unitId: t.unitId, side: 'left',
    audience: 'any_seller', reach: 'radius_200', point: SURAT, state: 'Gujarat', ...extra,
  });

const listing = (s: TestSeller, extra: Partial<TestListingOptions> = {}) =>
  insertTestListing(db, {
    businessId: s.businessId, userId: s.userId, kind: 'part', categoryId: t.partGroup.id, side: 'left',
    title: 'Temple roller', unitId: t.unitId, conditionId: t.conditionId, quantity: '5', ...extra,
  }).then((r) => r.id);

const send = (s: { token: string }, id: string, listingIds: string[], message?: string) =>
  app.inject({
    method: 'POST', url: `/part-requests/${id}/replies`, headers: auth(s.token),
    payload: { listingIds, ...(message !== undefined ? { message } : {}) },
  });
const createDraft = (s: TestSeller, body: object) => app.inject({ method: 'POST', url: '/listings', headers: auth(s.token), payload: body });
const adminPost = (id: string, path: string, payload: object = {}) =>
  app.inject({ method: 'POST', url: `/admin/listings/${id}/${path}`, headers: auth(admin.token), payload });
const versionOf = async (id: string) => (await db.select({ v: listings.version }).from(listings).where(eq(listings.id, id)))[0]!.v;
const replyOf = async (id: string) => (await db.select().from(partRequestReplies).where(eq(partRequestReplies.id, id)))[0]!;
const repliesOn = (requestId: string) => db.select().from(partRequestReplies).where(eq(partRequestReplies.partRequestId, requestId));
const listingsOf = async (businessId: string) => (await db.select({ id: listings.id }).from(listings).where(eq(listings.businessId, businessId))).length;

/** Notifications of a type on the request for a business's owner. */
async function noticesFor(requestId: string, businessId: string, type: string) {
  const { rows } = await db.execute<{ unread_count: number; params: Record<string, unknown> }>(sql`
    SELECT n.unread_count, n.params FROM notifications n JOIN users u ON u.id = n.user_id AND u.member_role = 'owner'
    WHERE n.part_request_id = ${requestId} AND n.business_id = ${businessId} AND n.type = ${type}`);
  return rows;
}

/** A listing with a pending reply on the request (the state after "List a matching part"). */
async function pendingOn(r: TestPartRequestRow, s: TestSeller, extra: Partial<TestListingOptions> = {}) {
  const l = await listing(s, extra);
  const reply = await insertTestReply({ partRequestId: r.id, sellerBusinessId: s.businessId, listingId: l, userId: s.userId, status: 'pending' });
  return { listingId: l, replyId: reply.id };
}
const deliver = (listingId: string) => runTx(txApp, (tx) => processListingChanged(tx, listingId));

beforeAll(async () => {
  app = await buildApp({ logger: false });
  t = await createTestPartTree();
  otherTree = await createTestPartTree();
  buyer = await createTestBusinessUser();
  businessIds.push(buyer.businessId);
  admin = await createTestAdmin('moderator');
  machineUnit = await createTestMachineUnit();
  brand = await createTestBrand();
  const models = await db
    .insert(machineModels)
    .values([
      { brandId: brand.id, machineTypeId: t.machineType.id, key: `ra${Date.now()}`, name: 'RA' },
      { brandId: brand.id, machineTypeId: t.machineType.id, key: `rb${Date.now()}`, name: 'RB' },
    ])
    .returning({ id: machineModels.id });
  [modelA, modelB] = [models[0]!.id, models[1]!.id];
  await db.insert(appSettings).values({ key: 'listing_review_first_n', value: 0 }).onConflictDoUpdate({ target: appSettings.key, set: { value: 0 } });
});

afterAll(async () => {
  await db.delete(appSettings).where(eq(appSettings.key, 'listing_review_first_n'));
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins([admin?.id].filter(Boolean) as string[]);
  await db.delete(machineModels).where(inArray(machineModels.id, [modelA, modelB].filter(Boolean)));
  await deleteTestBrands([brand?.id].filter(Boolean) as string[]);
  await t?.cleanup();
  await otherTree?.cleanup();
  if (machineUnit) await deleteTestUnits([machineUnit.id]);
  expect(Object.values(await countF8Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('POST /part-requests/:id/replies', () => {
  it('two listings → two delivered replies, the buyer grouped row at count 2, message masked for the seller', async () => {
    const s = await newSeller();
    const r = await request();
    const [a, b] = [await listing(s), await listing(s, { side: 'pair' })];
    const res = await send(s, r.id, [a, b], 'Call 9876543210 for this');
    expect(res.statusCode).toBe(200);
    const replies = res.json().data.replies;
    expect(replies.map((x: { listingId: string }) => x.listingId)).toEqual([a, b]);
    expect(replies.every((x: { status: string; message: string }) => x.status === 'delivered' && !x.message.includes('9876543210'))).toBe(true);
    const [row] = await noticesFor(r.id, buyer.businessId, 'part_request_reply');
    expect(Number(row!.unread_count)).toBe(2);
  });

  it('caps: a 4th listing on one request → REPLY_LIMIT; daily cap 2 → the 3rd → REPLY_DAILY_LIMIT', async () => {
    const s = await newSeller();
    const r = await request();
    const ls = [await listing(s), await listing(s), await listing(s), await listing(s)];
    expect((await send(s, r.id, ls.slice(0, 3))).statusCode).toBe(200);
    const fourth = await send(s, r.id, [ls[3]!]);
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().code).toBe('REPLY_LIMIT');

    const s2 = await newSeller();
    const restore = await setTestSettings({ part_request_replies_per_day: 2 });
    try {
      const [r1, r2] = [await request(), await request()];
      expect((await send(s2, r1.id, [await listing(s2), await listing(s2)])).statusCode).toBe(200);
      const third = await send(s2, r2.id, [await listing(s2)]);
      expect(third.statusCode).toBe(429);
      expect(third.json().code).toBe('REPLY_DAILY_LIMIT');
    } finally {
      await restore();
    }
  });

  it('fit reasons, REPLY_EXISTS, an ineligible seller 404, a viewer 403', async () => {
    const s = await newSeller();
    const r = await request();
    const elsewhere = await listing(s, { categoryId: otherTree.partGroup.id });
    const right = await listing(s, { side: 'right' });
    const bad = await send(s, r.id, [elsewhere, right]);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('REPLY_LISTING_INVALID');
    expect(bad.json().details.reasons).toEqual({ [elsewhere]: 'category', [right]: 'side' });

    const ok = await listing(s);
    expect((await send(s, r.id, [ok])).statusCode).toBe(200);
    const again = await send(s, r.id, [ok]);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('REPLY_EXISTS');

    const outsider = await createTestSeller({ machineCategoryId: otherTree.machineCategory.id });
    sellers.push(outsider);
    businessIds.push(outsider.businessId);
    const res404 = await send(outsider, r.id, [await listing(outsider, { categoryId: otherTree.partGroup.id })]);
    expect(res404.statusCode).toBe(404);
    expect(res404.json().code).toBe('PART_REQUEST_NOT_FOUND');

    const viewer = await addTestMember(s.businessId, 'viewer');
    const res403 = await send(viewer, r.id, [await listing(s)]);
    expect(res403.statusCode).toBe(403);
    expect(res403.json().code).toBe('VIEWER_READ_ONLY');
  });

  it('two concurrent sends with one slot left → one 200, one REPLY_LIMIT', async () => {
    const s = await newSeller();
    const r = await request();
    for (let i = 0; i < 2; i++) {
      await insertTestReply({ partRequestId: r.id, sellerBusinessId: s.businessId, listingId: await listing(s), userId: s.userId });
    }
    const [x, y] = [await listing(s), await listing(s)];
    const results = await Promise.all([send(s, r.id, [x]), send(s, r.id, [y])]);
    expect(results.map((res) => res.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((res) => res.statusCode === 409)!.json().code).toBe('REPLY_LIMIT');
    expect((await repliesOn(r.id)).filter((x) => x.status === 'delivered')).toHaveLength(3);
  });

  it('reply options: fitting first, each with its reason, and the caps left', async () => {
    const s = await newSeller();
    const r = await request();
    const right = await listing(s, { side: 'right' });
    const fits = await listing(s);
    const res = await app.inject({ method: 'GET', url: `/part-requests/${r.id}/reply-options`, headers: auth(s.token) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.listings.map((o: { listingId: string; fit: boolean; reason: string | null }) => [o.listingId, o.fit, o.reason])).toEqual([
      [fits, true, null],
      [right, false, 'side'],
    ]);
    expect(data.slotsLeft).toBe(3);
  });
});

describe('withdraw', () => {
  it('delivered → withdrawn; again → REPLY_NOT_OPEN; another business → REPLY_NOT_FOUND', async () => {
    const s = await newSeller();
    const r = await request();
    const res = await send(s, r.id, [await listing(s)]);
    const replyId = res.json().data.replies[0].id;
    const url = `/part-requests/${r.id}/replies/${replyId}/withdraw`;
    const w = await app.inject({ method: 'POST', url, headers: auth(s.token), payload: {} });
    expect(w.statusCode).toBe(200);
    expect(w.json().data.status).toBe('withdrawn');
    expect((await replyOf(replyId)).status).toBe('withdrawn');
    const again = await app.inject({ method: 'POST', url, headers: auth(s.token), payload: {} });
    expect(again.json().code).toBe('REPLY_NOT_OPEN');
    const other = await newSeller();
    const foreign = await app.inject({ method: 'POST', url, headers: auth(other.token), payload: {} });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().code).toBe('REPLY_NOT_FOUND');
  });
});

describe('POST /listings { kind, partRequestId } (§9.3)', () => {
  it('a part-group request → a prefilled draft (masked title, part number, side, fitments, norms, search text) + one pending reply', async () => {
    const s = await newSeller();
    const r = await request({
      categoryId: t.partGroup.id, name: 'Temple roller call 9876543210', partNumber: 'TR-77L', side: 'left',
      fits: [{ brandId: brand.id, modelId: modelA, yearFrom: 2010, yearTo: 2018 }],
    });
    const res = await createDraft(s, { kind: 'part', partRequestId: r.id });
    expect(res.statusCode).toBe(201);
    const view = res.json().data;
    expect(view.partRequestId).toBe(r.id);
    const [row] = await db.select().from(listings).where(eq(listings.id, view.id));
    expect(row!.status).toBe('draft');
    expect(row!.categoryId).toBe(t.partGroup.id);
    expect(row!.title).not.toContain('9876543210');
    expect((row!.title ?? '').startsWith('Temple roller')).toBe(true);
    expect(row!.titleNorm).toContain('temple roller');
    expect(row!.partNumber).toBe('TR-77L');
    expect(row!.partNumberNorm).toBe('TR77L');
    expect(row!.partNumberBase).toBe('TR77');
    expect(row!.side).toBe('left');
    expect(row!.searchText).toContain('temple');
    const fitments = await db.select().from(listingFitments).where(eq(listingFitments.listingId, view.id));
    expect(fitments.map((f) => [f.brandId, f.modelId, f.yearFrom, f.yearTo])).toEqual([[brand.id, modelA, 2010, 2018]]);
    const replies = await repliesOn(r.id);
    expect(replies.map((x) => [x.listingId, x.status, x.sellerBusinessId])).toEqual([[view.id, 'pending', s.businessId]]);
  });

  it('a machine-type part request → no category, a side-less one keeps not_applicable; a machine request → its first fit', async () => {
    const s = await newSeller();
    const r = await request({ side: null });
    const res = await createDraft(s, { kind: 'part', partRequestId: r.id });
    expect(res.statusCode).toBe(201);
    const [row] = await db.select().from(listings).where(eq(listings.id, res.json().data.id));
    expect(row!.categoryId).toBeNull();
    expect(row!.side).toBe('not_applicable');

    const m = await request({
      kind: 'machine', side: null, name: 'Water jet loom', unitId: machineUnit.id,
      fits: [{ brandId: brand.id, modelId: modelB }, { brandId: brand.id, modelId: modelA }],
    });
    const mres = await createDraft(s, { kind: 'machine', partRequestId: m.id });
    expect(mres.statusCode).toBe(201);
    const [machine] = await db.select().from(listingMachines).where(eq(listingMachines.listingId, mres.json().data.id));
    expect([machine!.brandId, machine!.modelId, machine!.year]).toEqual([brand.id, modelB, null]);
    const [mrow] = await db.select().from(listings).where(eq(listings.id, mres.json().data.id));
    expect(mrow!.categoryId).toBe(t.machineType.id);
  });

  it('every failing check rolls back both the draft and the reply', async () => {
    const s = await newSeller();
    const expectRefused = async (seller: TestSeller, body: object, status: number, code: string) => {
      const before = await listingsOf(seller.businessId);
      const res = await createDraft(seller, body);
      expect([res.statusCode, res.json().code]).toEqual([status, code]);
      expect(await listingsOf(seller.businessId)).toBe(before);
    };
    const pendingCount = async (id: string) => (await repliesOn(id)).filter((x) => x.status === 'pending').length;

    // Closed (the seller still sees it through an earlier reply) → PART_REQUEST_NOT_ACTIVE.
    const closed = await request();
    await insertTestReply({ partRequestId: closed.id, sellerBusinessId: s.businessId, listingId: await listing(s), userId: s.userId });
    await db.update(partRequests).set({ status: 'closed', closeReason: 'other', closedAt: new Date() }).where(eq(partRequests.id, closed.id));
    await expectRefused(s, { kind: 'part', partRequestId: closed.id }, 409, 'PART_REQUEST_NOT_ACTIVE');
    expect(await pendingCount(closed.id)).toBe(0);

    // Ineligible → 404.
    const outsider = await createTestSeller({ machineCategoryId: otherTree.machineCategory.id });
    sellers.push(outsider);
    businessIds.push(outsider.businessId);
    const open = await request();
    await expectRefused(outsider, { kind: 'part', partRequestId: open.id }, 404, 'PART_REQUEST_NOT_FOUND');

    // Kind mismatch → REPLY_LISTING_INVALID.
    await expectRefused(s, { kind: 'machine', partRequestId: open.id }, 400, 'REPLY_LISTING_INVALID');

    // Reply cap full → REPLY_LIMIT.
    const full = await request();
    for (let i = 0; i < 3; i++) {
      await insertTestReply({ partRequestId: full.id, sellerBusinessId: s.businessId, listingId: await listing(s), userId: s.userId });
    }
    await expectRefused(s, { kind: 'part', partRequestId: full.id }, 409, 'REPLY_LIMIT');

    // Drafts full → DRAFT_LIMIT, after the request checks passed.
    const d = await newSeller();
    for (let i = 0; i < 20; i++) await listing(d, { status: 'draft', publishedAt: null });
    await expectRefused(d, { kind: 'part', partRequestId: open.id }, 409, 'DRAFT_LIMIT');
    expect(await pendingCount(open.id)).toBe(0);
  });
});

describe('pending replies through the work job (§9.3)', () => {
  it('the draft approved → delivered and the buyer told', async () => {
    const s = await newSeller();
    const r = await request();
    const { listingId, replyId } = await pendingOn(r, s, { status: 'pending_review', returnStatus: 'live' });
    expect((await adminPost(listingId, 'approve', { version: await versionOf(listingId) })).statusCode).toBe(200);
    await runPartRequestWork(txApp);
    const reply = await replyOf(replyId);
    expect(reply.status).toBe('delivered');
    expect(reply.deliveredAt).not.toBeNull();
    expect(await noticesFor(r.id, buyer.businessId, 'part_request_reply')).toHaveLength(1);
    // Rule 7: a delivered reply is not also an auto match.
    const { rows } = await db.execute(sql`SELECT 1 FROM part_request_matches WHERE part_request_id = ${r.id}`);
    expect(rows).toHaveLength(0);
  });

  it('drops on going live: blocked, audience now verified-only, the seller owner suspended', async () => {
    const blockedSeller = await newSeller();
    const r1 = await request();
    const p1 = await pendingOn(r1, blockedSeller);
    await db.insert(businessBlocks).values({ blockerBusinessId: buyer.businessId, blockedBusinessId: blockedSeller.businessId, createdByUserId: buyer.userId });
    await deliver(p1.listingId);
    expect([(await replyOf(p1.replyId)).status, (await replyOf(p1.replyId)).dropReason]).toEqual(['dropped', 'blocked']);
    expect(await noticesFor(r1.id, blockedSeller.businessId, 'part_request_reply_dropped')).toHaveLength(1);

    const unverified = await newSeller();
    const r2 = await request();
    const p2 = await pendingOn(r2, unverified);
    await db.update(partRequests).set({ audience: 'verified_only' }).where(eq(partRequests.id, r2.id));
    await deliver(p2.listingId);
    expect((await replyOf(p2.replyId)).dropReason).toBe('not_eligible');

    const suspended = await newSeller();
    const r3 = await request();
    const p3 = await pendingOn(r3, suspended);
    await db.update(users).set({ status: 'suspended' }).where(eq(users.businessId, suspended.businessId));
    await deliver(p3.listingId);
    expect((await replyOf(p3.replyId)).dropReason).toBe('not_eligible');
    expect(await noticesFor(r3.id, buyer.businessId, 'part_request_reply')).toHaveLength(0);
  });

  it('removal by the seller is silent; by the team the seller is told; a moderation reject tells the seller', async () => {
    const s = await newSeller();
    const r = await request();
    const own = await pendingOn(r, s);
    const res = await app.inject({ method: 'POST', url: `/listings/${own.listingId}/actions`, headers: auth(s.token), payload: { action: 'remove' } });
    expect(res.statusCode).toBe(200);
    await runPartRequestWork(txApp);
    expect((await replyOf(own.replyId)).dropReason).toBe('listing_removed');
    expect(await noticesFor(r.id, s.businessId, 'part_request_reply_dropped')).toHaveLength(0);

    const s2 = await newSeller();
    const r2 = await request();
    const team = await pendingOn(r2, s2);
    expect((await adminPost(team.listingId, 'remove', { reason: 'Test removal reason' })).statusCode).toBe(200);
    await runPartRequestWork(txApp);
    expect((await replyOf(team.replyId)).dropReason).toBe('listing_removed_by_team');
    expect(await noticesFor(r2.id, s2.businessId, 'part_request_reply_dropped')).toHaveLength(1);

    const s3 = await newSeller();
    const r3 = await request();
    const rejected = await pendingOn(r3, s3, { status: 'pending_review', returnStatus: 'live' });
    const rej = await adminPost(rejected.listingId, 'reject', { version: await versionOf(rejected.listingId), reason: 'Test reject reason' });
    expect(rej.statusCode).toBe(200);
    await runPartRequestWork(txApp);
    expect((await replyOf(rejected.replyId)).dropReason).toBe('listing_rejected');
    expect(await noticesFor(r3.id, s3.businessId, 'part_request_reply_dropped')).toHaveLength(1);
  });

  it('the request closed before approval → dropped request_closed; nothing delivered later', async () => {
    const s = await newSeller();
    const r = await request();
    const p = await pendingOn(r, s, { status: 'pending_review', returnStatus: 'live' });
    // What the buyer's close does (lane A1): the status write and the pending drops, under the request lock.
    await runTx(txApp, async (tx) => {
      const [row] = await tx.select().from(partRequests).where(eq(partRequests.id, r.id)).for('no key update');
      const closed = await writeRequestStatus(tx, row!, 'close', { closeReason: 'found_elsewhere' });
      await dropPendingRepliesForRequest(tx, closed, 'request_closed');
    });
    expect((await adminPost(p.listingId, 'approve', { version: await versionOf(p.listingId) })).statusCode).toBe(200);
    await runPartRequestWork(txApp);
    const reply = await replyOf(p.replyId);
    expect([reply.status, reply.dropReason]).toEqual(['dropped', 'request_closed']);
    expect(await noticesFor(r.id, buyer.businessId, 'part_request_reply')).toHaveLength(0);
    expect(
      await db.select().from(partRequestReplies).where(and(eq(partRequestReplies.partRequestId, r.id), eq(partRequestReplies.status, 'delivered'))),
    ).toHaveLength(0);
  });
});
