import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, notifications, partRequestReplies, partRequestWork, partRequests, reports } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import {
  countF8Rows,
  createTestPartTree,
  insertTestPartRequest,
  insertTestReply,
  type TestPartRequestRow,
  type TestPartTree,
} from './_helpers/test-part-requests.js';

// A3-4: admin part requests (F8 spec §14, §9.1 remove / restore) and the Reports & flags widening to `part_request`.

let app: FastifyInstance;
let tree: TestPartTree;
let buyer: TestBusinessUser;
let sellers: TestSeller[];
let moderator: { id: string; token: string };
let support: { id: string; token: string };
let operations: { id: string; token: string };
const businessIds: string[] = [];
const DEVANAGARI_PHONE = '९८७६५ ४३२१०';
const REASON = 'Spam requirement posted repeatedly';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (url: string, token = moderator.token) => app.inject({ method: 'GET', url, headers: auth(token) });
const post = (url: string, payload: object, token = moderator.token) => app.inject({ method: 'POST', url, headers: auth(token), payload });

const newRequest = (o: Partial<Parameters<typeof insertTestPartRequest>[0]> = {}): Promise<TestPartRequestRow> =>
  insertTestPartRequest({ businessId: buyer.businessId, userId: buyer.userId, categoryId: tree.partGroup.id, unitId: tree.unitId, side: 'left', ...o });

async function report(requestId: string, reporter: TestSeller): Promise<string> {
  const [r] = await db
    .insert(reports)
    .values({ targetType: 'part_request', targetId: requestId, reporterUserId: reporter.userId, reporterBusinessId: reporter.businessId, reason: 'spam' })
    .returning({ id: reports.id });
  return r!.id;
}

const statusOf = async (id: string) => (await db.select().from(partRequests).where(eq(partRequests.id, id)))[0]!;
const notesOf = (id: string) => db.select().from(notifications).where(eq(notifications.partRequestId, id));
const auditsOf = (id: string, action: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, action)));

beforeAll(async () => {
  app = await buildApp({ logger: false });
  tree = await createTestPartTree();
  buyer = await createTestBusinessUser();
  sellers = [
    await createTestSeller({ machineCategoryId: tree.machineCategory.id }),
    await createTestSeller({ machineCategoryId: tree.machineCategory.id }),
  ];
  businessIds.push(buyer.businessId, ...sellers.map((s) => s.businessId));
  moderator = await createTestAdmin('moderator');
  support = await createTestAdmin('support');
  operations = await createTestAdmin('operations');
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins([moderator.id, support.id, operations.id]);
  await tree.cleanup();
  expect(Object.values(await countF8Rows()).every((n) => n === 0)).toBe(true);
  await app.close();
});

describe('GET /admin/part-requests', () => {
  it('filters by business, status and reported; active first, then newest; operations refused', async () => {
    const older = await newRequest({ name: 'Older active roller' });
    const closed = await newRequest({ name: 'Closed roller', status: 'closed' });
    const newer = await newRequest({ name: 'Newer active roller' });
    await report(newer.id, sellers[0]!);

    const all = await get(`/admin/part-requests?businessId=${buyer.businessId}&pageSize=100`);
    expect(all.statusCode).toBe(200);
    const ids = all.json().data.rows.map((r: { id: string }) => r.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(closed.id));

    const onlyClosed = (await get(`/admin/part-requests?businessId=${buyer.businessId}&status=closed`)).json().data;
    expect(onlyClosed.rows.map((r: { id: string }) => r.id)).toEqual([closed.id]);
    expect(onlyClosed.total).toBe(1);

    const reported = (await get(`/admin/part-requests?businessId=${buyer.businessId}&reported=true`, support.token)).json().data;
    expect(reported.rows.map((r: { id: string }) => r.id)).toEqual([newer.id]);
    expect(reported.rows[0]).toMatchObject({ openReports: 1, buyer: { businessId: buyer.businessId }, categoryPath: expect.stringContaining(' › ') });

    expect((await get('/admin/part-requests', operations.token)).statusCode).toBe(403);
  });
});

describe('GET /admin/part-requests/:id', () => {
  it('masks a Devanagari phone in the note, name and a reply message; no phone key; eligibleNow from the fixture', async () => {
    const req = await newRequest({ name: `Roller ${DEVANAGARI_PHONE}`, note: `Call me on ${DEVANAGARI_PHONE}` });
    const { id: listingId } = await insertTestListing(db, {
      businessId: sellers[0]!.businessId, userId: sellers[0]!.userId, kind: 'part', categoryId: tree.partGroup.id, side: 'left',
    });
    await insertTestReply({
      partRequestId: req.id, sellerBusinessId: sellers[0]!.businessId, listingId, userId: sellers[0]!.userId,
      message: `Ring ${DEVANAGARI_PHONE}`,
    });

    const res = await get(`/admin/part-requests/${req.id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    const text = JSON.stringify(body);
    expect(text).not.toContain('९८७६५');
    expect(text).not.toContain('४३२१०');
    expect(text).not.toMatch(/"phone"|pincode|photoKeys/);
    expect(text).not.toContain(buyer.phone);
    expect(body.eligibleNow).toBe(2);
    expect(body.replies).toHaveLength(1);
    expect(body).toMatchObject({ status: 'active', matched: true, buyer: { businessId: buyer.businessId }, counts: { replies: 1 } });

    expect((await get(`/admin/part-requests/00000000-0000-4000-8000-000000000000`)).json().code).toBe('PART_REQUEST_NOT_FOUND');
  });
});

describe('remove / restore', () => {
  it('remove: removed, pending reply dropped, open report actioned, one buyer notice, one audit row; twice → 409', async () => {
    const req = await newRequest();
    const { id: draftId } = await insertTestListing(db, {
      businessId: sellers[1]!.businessId, userId: sellers[1]!.userId, kind: 'part', categoryId: tree.partGroup.id, status: 'draft',
    });
    const pending = await insertTestReply({
      partRequestId: req.id, sellerBusinessId: sellers[1]!.businessId, listingId: draftId, userId: sellers[1]!.userId, status: 'pending',
    });
    const reportId = await report(req.id, sellers[0]!);

    const res = await post(`/admin/part-requests/${req.id}/remove`, { reason: REASON });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'removed', returnStatus: 'active', removedReason: REASON });
    expect(await statusOf(req.id)).toMatchObject({ status: 'removed', returnStatus: 'active', removedByAdminId: moderator.id });
    const [reply] = await db.select().from(partRequestReplies).where(eq(partRequestReplies.id, pending.id));
    expect(reply).toMatchObject({ status: 'dropped', dropReason: 'request_removed' });
    const [rep] = await db.select().from(reports).where(eq(reports.id, reportId));
    expect(rep).toMatchObject({ status: 'actioned', resolvedBy: moderator.id });
    const notes = await notesOf(req.id);
    expect(notes.filter((n) => n.type === 'part_request_removed').map((n) => n.businessId)).toEqual([buyer.businessId]);
    expect(notes.filter((n) => n.type === 'part_request_reply_dropped').map((n) => n.businessId)).toEqual([sellers[1]!.businessId]);
    const audits = await auditsOf(req.id, 'part_request.remove');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ adminId: moderator.id, before: { status: 'active' }, after: { status: 'removed' } });

    const again = await post(`/admin/part-requests/${req.id}/remove`, { reason: REASON });
    expect([again.statusCode, again.json().code]).toEqual([409, 'PART_REQUEST_TRANSITION_NOT_ALLOWED']);
  });

  it('restore: back to active with no notification and no work row; audited', async () => {
    const req = await newRequest();
    expect((await post(`/admin/part-requests/${req.id}/remove`, { reason: REASON }, support.token)).statusCode).toBe(200);
    const before = (await notesOf(req.id)).length;

    const res = await post(`/admin/part-requests/${req.id}/restore`, { reason: 'Removed by mistake, restoring' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'active', returnStatus: null, removedAt: null });
    expect(await notesOf(req.id)).toHaveLength(before);
    expect(await db.select().from(partRequestWork).where(eq(partRequestWork.subjectId, req.id))).toHaveLength(0);
    expect(await auditsOf(req.id, 'part_request.restore')).toHaveLength(1);
  });

  it('restore of an active return past its expiry lands expired; a short reason is a 400', async () => {
    const req = await newRequest({ status: 'removed', returnStatus: 'active', expiresAt: new Date(Date.now() - 60_000) });
    const short = await post(`/admin/part-requests/${req.id}/restore`, { reason: 'no' });
    expect([short.statusCode, short.json().code]).toEqual([400, 'VALIDATION_ERROR']);
    expect((await statusOf(req.id)).status).toBe('removed');

    const res = await post(`/admin/part-requests/${req.id}/restore`, { reason: 'Restoring after a review' });
    expect(res.statusCode).toBe(200);
    expect((await statusOf(req.id)).status).toBe('expired');
  });
});

describe('Reports & flags: part_request target', () => {
  it('lists the request’s report with its masked name and resolves it with an audit row', async () => {
    const req = await newRequest({ name: `Roller ${DEVANAGARI_PHONE}` });
    const reportId = await report(req.id, sellers[1]!);

    const list = await get('/admin/reports?target=part_request&status=open');
    expect(list.statusCode).toBe(200);
    const row = list.json().data.items.find((r: { id: string }) => r.id === reportId);
    expect(row).toMatchObject({ target: 'part_request', targetId: req.id, partRequestId: req.id, parties: null, review: null });
    expect(row.partRequestName).not.toContain('९८७६५');

    const resolve = await post(`/admin/reports/${reportId}/resolve`, { outcome: 'dismissed', note: 'Nothing wrong with it' });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().data).toMatchObject({ status: 'dismissed', partRequestId: req.id });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityId, reportId), eq(auditLog.action, 'report.resolve')));
    expect(audits).toHaveLength(1);
    expect((await db.execute(sql`SELECT status FROM reports WHERE id = ${reportId}`)).rows[0]).toEqual({ status: 'dismissed' });
  });
});
