import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { AdminListingDetail, AdminModerationQueue, ListingKind, ListingStatus, ModerationCounts } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, listingFitments, listings, reports } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBrand, createTestCatalog, deleteTestBrands, deleteTestCatalog, type TestBrand, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestHistory,
  insertTestListing,
  type TestListingOptions,
  type TestSeller,
} from './_helpers/test-listings.js';

// Moderation (F2 plan Task 16, spec §11.1–§11.3, §11.6, R13, R14, R33, R34, R50–R53, amendments 2 and 4): the queue
// tabs and counts, the moderator's status actions with their version checks and audit rows, the admin edit, resolving
// reports, bulk hide / remove and roles. The media delete is lane L1's suite. Other suites share the test database,
// so queue assertions look at this suite's rows only.

const DAY = 24 * 60 * 60 * 1000;
let app: FastifyInstance;
let catalog: TestCatalog;
let brand: TestBrand;
let machineUnit: { id: string; key: string };
let moderator: { id: string; token: string };
let support: { id: string; token: string };
const sellers: TestSeller[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const req = (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: auth(token), ...(payload !== undefined ? { payload: payload as object } : {}) });
const post = (url: string, payload?: unknown, token = moderator.token) => req('POST', url, token, payload);

async function seller(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: catalog.categoryId, ...opts });
  sellers.push(s);
  return s;
}

const listingOf = (s: TestSeller, status: ListingStatus, kind: ListingKind = 'part', extra: Partial<TestListingOptions> = {}) =>
  insertTestListing(db, {
    businessId: s.businessId,
    userId: s.userId,
    kind,
    status,
    categoryId: kind === 'part' ? catalog.motorsGroupId : catalog.machineTypeId,
    unitId: kind === 'part' ? catalog.unitId : machineUnit.id,
    conditionId: kind === 'machine_rental' ? null : catalog.conditionId,
    quantity: kind === 'part' ? '10' : '1',
    ...(kind === 'part' ? {} : { machine: { brandOther: 'Local make' } }),
    returnStatus: status === 'hidden' ? 'live' : null,
    ...extra,
  }).then((r) => r.id);

const rowOf = async (id: string) => (await db.select().from(listings).where(eq(listings.id, id)))[0]!;
const auditOf = (id: string, action: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, action)));

async function report(listingId: string, opts: { status?: 'open' | 'dismissed'; createdAt?: Date } = {}): Promise<string> {
  const reporter = await seller();
  const [row] = await db
    .insert(reports)
    .values({
      targetType: 'listing', targetId: listingId, reporterUserId: reporter.userId, reporterBusinessId: reporter.businessId,
      reason: 'stock_photos', status: opts.status ?? 'open', ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning({ id: reports.id });
  return row!.id;
}

const queue = async (tab: string): Promise<AdminModerationQueue> => {
  const res = await req('GET', `/admin/moderation/queue?tab=${tab}`, moderator.token);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data;
};
const mine = (q: AdminModerationQueue, ids: string[]) => q.rows.filter((r) => ids.includes(r.id));

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  brand = await createTestBrand({ makesMachines: true });
  machineUnit = await createTestMachineUnit();
  moderator = await createTestAdmin('moderator');
  support = await createTestAdmin('support');
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins([moderator?.id, support?.id].filter(Boolean) as string[]);
  if (brand) await deleteTestBrands([brand.id]);
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  if (machineUnit) await deleteTestUnits([machineUnit.id]);
  await app?.close();
});

describe('queue and counts', () => {
  it('lists Review oldest first with the review reasons as pills', async () => {
    const s = await seller({ gst: true });
    const older = await listingOf(s, 'pending_review', 'part', { statusChangedAt: new Date('2001-01-01'), reviewReasons: ['first_listings', 'price_check'] });
    const newer = await listingOf(s, 'pending_review', 'part', { statusChangedAt: new Date('2001-01-02'), reviewReasons: ['resubmitted'] });
    const q = await queue('review');
    expect(q).toMatchObject({ tab: 'review', page: 1, pageSize: 50 });
    const rows = mine(q, [older, newer]);
    expect(rows.map((r) => r.id)).toEqual([older, newer]);
    expect(rows[0]).toMatchObject({
      reviewReasons: ['first_listings', 'price_check'], status: 'pending_review', kind: 'part',
      business: { id: s.businessId, gstVerified: true }, openReports: 0, decision: null,
    });
    expect(rows[0]!.statusChangedAt).toBe(new Date('2001-01-01').toISOString());

    const counts: ModerationCounts = (await req('GET', '/admin/moderation/counts', moderator.token)).json().data;
    expect(counts.review).toBeGreaterThanOrEqual(2);
  });

  it('lists Reported by open reports, then the oldest report, never a removed listing', async () => {
    const s = await seller();
    const many = await listingOf(s, 'live');
    const one = await listingOf(s, 'paused');
    const removed = await listingOf(s, 'removed');
    for (let i = 0; i < 3; i++) await report(many);
    await report(one, { createdAt: new Date(Date.now() - DAY) });
    await report(one, { status: 'dismissed' });
    await report(removed);
    const q = await queue('reported');
    const rows = mine(q, [many, one, removed]);
    expect(rows.map((r) => [r.id, r.openReports])).toEqual([
      [many, 3],
      [one, 1],
    ]);
    expect(rows[1]!.lastReportAt).not.toBeNull();
    const counts: ModerationCounts = (await req('GET', '/admin/moderation/counts', moderator.token)).json().data;
    expect(counts.reported).toBeGreaterThanOrEqual(2);
  });

  it('lists in Decided an approval from today, not one 91 days ago', async () => {
    const s = await seller({ gst: true });
    const today = await listingOf(s, 'pending_review', 'part', { reviewReasons: ['first_listings'] });
    expect((await post(`/admin/listings/${today}/approve`, { version: 1 })).statusCode).toBe(200);
    const old = await listingOf(s, 'live');
    await insertTestHistory(db, {
      listingId: old, from: 'pending_review', to: 'live', action: 'approve', actor: 'admin', adminId: moderator.id,
      createdAt: new Date(Date.now() - 91 * DAY),
    });
    const q = await queue('decided');
    const rows = mine(q, [today, old]);
    expect(rows.map((r) => r.id)).toEqual([today]);
    expect(rows[0]!.decision).toMatchObject({ action: 'approve' });
  });

  it('refuses a support admin (403) and an unknown tab (400)', async () => {
    expect((await req('GET', '/admin/moderation/queue', support.token)).statusCode).toBe(403);
    expect((await req('GET', '/admin/moderation/counts', support.token)).statusCode).toBe(403);
    expect((await req('GET', '/admin/moderation/queue?tab=nope', moderator.token)).statusCode).toBe(400);
  });
});

describe('approve, ask for changes, reject', () => {
  it('approves with the right version into live, accepting the flags, with one audit row and the detail back', async () => {
    const s = await seller({ gst: true });
    const id = await listingOf(s, 'pending_review', 'part', { flags: ['price_check'], reviewReasons: ['price_check'], firstLiveAt: null });
    const res = await post(`/admin/listings/${id}/approve`, { version: 1 });
    expect(res.statusCode, res.body).toBe(200);
    const detail: AdminListingDetail = res.json().data;
    expect(detail.listing).toMatchObject({ id, status: 'live', acceptedFlags: ['price_check'], reviewReasons: [], returnStatus: null });
    expect(detail.listing.firstLiveAt).not.toBeNull();
    expect(detail.history[0]).toMatchObject({ action: 'approve', actor: 'admin', toStatus: 'live', adminName: 'Test Admin' });
    const audit = await auditOf(id, 'listing.approve');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ adminId: moderator.id, entityType: 'listing', before: { status: 'pending_review' }, after: { status: 'live' } });
  });

  it('approves back into the stored return_status (rented)', async () => {
    const s = await seller({ gst: true });
    const id = await listingOf(s, 'pending_review', 'machine_rental', { returnStatus: 'rented', reviewReasons: ['edit_flagged'] });
    const res = await post(`/admin/listings/${id}/approve`, { version: 1 });
    expect(res.json().data.listing).toMatchObject({ status: 'rented', returnStatus: null });
  });

  it("refuses approve after the seller's edit (409 LISTING_CHANGED): status unchanged, no audit row", async () => {
    const s = await seller({ gst: true });
    const id = await listingOf(s, 'pending_review', 'part', { reviewReasons: ['first_listings'] });
    const edit = await req('PATCH', `/listings/${id}`, s.token, { description: 'Now with a better description' });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json().data.version).toBe(2);
    const res = await post(`/admin/listings/${id}/approve`, { version: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('LISTING_CHANGED');
    expect((await rowOf(id)).status).toBe('pending_review');
    expect(await auditOf(id, 'listing.approve')).toHaveLength(0);
    expect((await post(`/admin/listings/${id}/approve`, { version: 2 })).statusCode).toBe(200);
  });

  it('asks for changes only with a message, and rejects into rejected; the seller can resubmit', async () => {
    const s = await seller({ gst: true });
    const id = await listingOf(s, 'pending_review', 'part', { returnStatus: 'live' });
    const noMessage = await post(`/admin/listings/${id}/ask-for-changes`, { version: 1, message: ' ' });
    expect(noMessage.statusCode).toBe(400);
    expect((await post(`/admin/listings/${id}/ask-for-changes`, { version: 1 })).statusCode).toBe(400);
    const asked = await post(`/admin/listings/${id}/ask-for-changes`, { version: 1, message: 'Add a photo of the label' });
    expect(asked.statusCode, asked.body).toBe(200);
    expect(asked.json().data.listing).toMatchObject({
      status: 'rejected', returnStatus: null, moderation: { outcome: 'changes_requested', note: 'Add a photo of the label' },
    });
    expect(await auditOf(id, 'listing.ask_for_changes')).toHaveLength(1);

    const other = await listingOf(s, 'pending_review', 'part', { returnStatus: 'live' });
    expect((await post(`/admin/listings/${other}/reject`, { version: 1 })).statusCode).toBe(400);
    const rejected = await post(`/admin/listings/${other}/reject`, { version: 1, reason: 'Not a machine part' });
    expect(rejected.json().data.listing).toMatchObject({ status: 'rejected', returnStatus: null, moderation: { outcome: 'rejected' } });
    expect(await auditOf(other, 'listing.reject')).toHaveLength(1);

    const resubmit = await req('POST', `/listings/${other}/publish`, s.token);
    expect(resubmit.statusCode, resubmit.body).toBe(200);
    expect(resubmit.json().data.outcome).toBe('pending_review');
  });
});

describe('hide, unhide, remove', () => {
  it('hides a live listing with an open report (report actioned), unhides it refreshed, and removes it', async () => {
    const s = await seller();
    const id = await listingOf(s, 'live', 'part', { refreshedAt: new Date(Date.now() - 10 * DAY) });
    const reportId = await report(id);
    // A seller edit since the moderator opened it doesn't matter: hide never checks the version (R53).
    await db.update(listings).set({ version: 5 }).where(eq(listings.id, id));

    const hidden = await post(`/admin/listings/${id}/hide`, { reason: 'Stock photos only' });
    expect(hidden.statusCode, hidden.body).toBe(200);
    expect(hidden.json().data.listing).toMatchObject({ status: 'hidden', returnStatus: 'live', statusReason: 'Stock photos only' });
    expect(hidden.json().data.reports[0]).toMatchObject({ id: reportId, status: 'actioned' });
    const [hideAudit] = await auditOf(id, 'listing.hide');
    expect(hideAudit).toMatchObject({ before: { status: 'live' }, after: { status: 'hidden', reportsActioned: 1 } });

    const unhidden = await post(`/admin/listings/${id}/unhide`);
    expect(unhidden.statusCode, unhidden.body).toBe(200);
    expect(unhidden.json().data.listing).toMatchObject({ status: 'live', returnStatus: null });
    expect((await rowOf(id)).refreshedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await auditOf(id, 'listing.unhide')).toHaveLength(1);

    expect((await post(`/admin/listings/${id}/remove`, { reason: 'x' })).statusCode).toBe(400);
    const removed = await post(`/admin/listings/${id}/remove`, { reason: 'Fraudulent seller' });
    expect(removed.json().data.listing).toMatchObject({ status: 'removed', statusReason: 'Fraudulent seller' });
    expect(await auditOf(id, 'listing.remove')).toHaveLength(1);
    const mineRes = await req('GET', '/listings/mine?group=removed_by_team', s.token);
    expect(mineRes.json().data.items.map((c: { id: string }) => c.id)).toContain(id);
  });

  it('refuses to unhide a hidden listing without a photo (400 LISTING_INCOMPLETE)', async () => {
    const s = await seller();
    const id = await listingOf(s, 'hidden', 'part', { photos: 0 });
    const res = await post(`/admin/listings/${id}/unhide`);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('LISTING_INCOMPLETE');
    expect((await rowOf(id)).status).toBe('hidden');
    expect(await auditOf(id, 'listing.unhide')).toHaveLength(0);
  });

  it('answers 409 LISTING_TRANSITION_NOT_ALLOWED for a disallowed move, and 404 for an unknown listing', async () => {
    const s = await seller();
    const draft = await listingOf(s, 'draft');
    const res = await post(`/admin/listings/${draft}/hide`, { reason: 'Nope nope' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'LISTING_TRANSITION_NOT_ALLOWED', details: { from: 'draft', action: 'hide' } });
    expect((await post(`/admin/listings/${randomUUID()}/approve`, { version: 1 })).statusCode).toBe(404);
  });
});

describe('admin edit (R33)', () => {
  it('refuses a category whose template rejects the specs, accepts a compatible one with a side, and needs the version', async () => {
    const s = await seller();
    const temple = await listingOf(s, 'live', 'part', { categoryId: catalog.partGroupId, side: 'left', specs: { temple_type: 'ring' } });
    const bad = await req('PATCH', `/admin/listings/${temple}`, moderator.token, { version: 1, categoryId: catalog.motorsGroupId });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: 'SPECS_INVALID', details: { temple_type: 'unknown_field' } });

    const motor = await listingOf(s, 'live', 'part', { categoryId: catalog.motorsGroupId, side: 'not_applicable', specs: { frame_width: 12 } });
    const noSide = await req('PATCH', `/admin/listings/${motor}`, moderator.token, { version: 1, categoryId: catalog.partGroupId });
    expect(noSide.json().code).toBe('SIDE_REQUIRED');
    const stale = await req('PATCH', `/admin/listings/${motor}`, moderator.token, { version: 3, categoryId: catalog.partGroupId, side: 'left' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('LISTING_CHANGED');

    const ok = await req('PATCH', `/admin/listings/${motor}`, moderator.token, { version: 1, categoryId: catalog.partGroupId, side: 'left' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data.listing).toMatchObject({ categoryId: catalog.partGroupId, side: 'left', status: 'live', version: 2 });
    const [edit] = await auditOf(motor, 'listing.edit');
    expect(edit).toMatchObject({
      before: { categoryId: catalog.motorsGroupId, side: 'not_applicable' },
      after: { categoryId: catalog.partGroupId, side: 'left' },
    });

    // Back to a node without sides: the side becomes not_applicable.
    const back = await req('PATCH', `/admin/listings/${motor}`, moderator.token, { version: 2, categoryId: catalog.motorsGroupId });
    expect(back.json().data.listing).toMatchObject({ categoryId: catalog.motorsGroupId, side: 'not_applicable' });
  });

  it("marks new or edited fitment rows admin and keeps the seller's unchanged rows", async () => {
    const s = await seller();
    const id = await listingOf(s, 'live', 'part', { fitments: [{ brandId: brand.id, yearFrom: 2010 }] });
    const res = await req('PATCH', `/admin/listings/${id}`, moderator.token, {
      version: 1,
      fitments: [{ brandId: brand.id, yearFrom: 2010 }, { brandId: brand.id, modelOther: 'XL-9', yearFrom: 2015, yearTo: 2018 }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const rows = await db.select().from(listingFitments).where(eq(listingFitments.listingId, id)).orderBy(asc(listingFitments.sortOrder));
    expect(rows.map((r) => [r.modelOther, r.source])).toEqual([
      [null, 'seller'],
      ['XL-9', 'admin'],
    ]);
    expect(await auditOf(id, 'listing.edit')).toHaveLength(1);
    // The same list again changes nothing: no version bump, no second audit row.
    const again = await req('PATCH', `/admin/listings/${id}`, moderator.token, {
      version: 2,
      fitments: [{ brandId: brand.id, yearFrom: 2010 }, { brandId: brand.id, modelOther: 'XL-9', yearFrom: 2015, yearTo: 2018 }],
    });
    expect(again.json().data.listing.version).toBe(2);
    expect(await auditOf(id, 'listing.edit')).toHaveLength(1);
  });

  it('refuses side and fitments on a machine (400 FIELD_NOT_FOR_KIND) and an empty patch', async () => {
    const s = await seller();
    const id = await listingOf(s, 'live', 'machine');
    expect((await req('PATCH', `/admin/listings/${id}`, moderator.token, { version: 1, side: 'left' })).json().code).toBe('FIELD_NOT_FOR_KIND');
    expect((await req('PATCH', `/admin/listings/${id}`, moderator.token, { version: 1 })).statusCode).toBe(400);
  });
});

describe('reports, roles and bulk', () => {
  it('resolves every open report, and answers 409 NO_OPEN_REPORTS when none is open', async () => {
    const s = await seller();
    const id = await listingOf(s, 'live');
    const none = await post(`/admin/listings/${id}/reports/resolve`, { outcome: 'dismissed' });
    expect(none.statusCode).toBe(409);
    expect(none.json().code).toBe('NO_OPEN_REPORTS');
    await report(id);
    await report(id);
    const res = await post(`/admin/listings/${id}/reports/resolve`, { outcome: 'dismissed', note: 'Photos are real' });
    expect(res.statusCode, res.body).toBe(200);
    const detail: AdminListingDetail = res.json().data;
    expect(detail.listing.status).toBe('live');
    expect(detail.reports.map((r) => [r.status, r.resolutionNote])).toEqual([
      ['dismissed', 'Photos are real'],
      ['dismissed', 'Photos are real'],
    ]);
    const [audit] = await auditOf(id, 'listing_reports.resolve');
    expect(audit).toMatchObject({ before: { openReports: 2 }, after: { outcome: 'dismissed', note: 'Photos are real' } });
  });

  it('refuses every action to a support admin (403)', async () => {
    const s = await seller();
    const id = await listingOf(s, 'pending_review');
    for (const [method, url, body] of [
      ['POST', `/admin/listings/${id}/approve`, { version: 1 }],
      ['POST', `/admin/listings/${id}/hide`, { reason: 'Because' }],
      ['POST', `/admin/listings/${id}/unhide`, undefined],
      ['POST', `/admin/listings/${id}/reports/resolve`, { outcome: 'dismissed' }],
      ['PATCH', `/admin/listings/${id}`, { version: 1, side: 'left' }],
      ['POST', '/admin/listings/bulk', { action: 'hide', ids: [id], reason: 'Because' }],
    ] as const) {
      expect((await req(method, url, support.token, body)).statusCode, url).toBe(403);
    }
    expect((await rowOf(id)).status).toBe('pending_review');
  });

  it('bulk-removes, skipping an already-removed and an unknown listing with their codes, one audit row each', async () => {
    const s = await seller();
    const a = await listingOf(s, 'live');
    const b = await listingOf(s, 'paused');
    const gone = await listingOf(s, 'removed');
    const unknown = randomUUID();
    expect((await post('/admin/listings/bulk', { action: 'remove', ids: [a], reason: 'x' })).statusCode).toBe(400);
    expect((await post('/admin/listings/bulk', { action: 'remove', ids: [], reason: 'Spam batch' })).statusCode).toBe(400);
    const res = await post('/admin/listings/bulk', { action: 'remove', ids: [a, gone, b, unknown, a], reason: 'Spam batch' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toEqual({
      done: [a, b],
      skipped: [
        { id: gone, code: 'LISTING_TRANSITION_NOT_ALLOWED' },
        { id: unknown, code: 'LISTING_NOT_FOUND' },
      ],
    });
    expect((await rowOf(a)).status).toBe('removed');
    expect((await rowOf(b)).statusReason).toBe('Spam batch');
    for (const id of [a, b]) {
      const rows = await auditOf(id, 'listing.remove');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.after).toMatchObject({ status: 'removed', bulk: true });
    }
    expect(await auditOf(gone, 'listing.remove')).toHaveLength(0);
  });

  it('refuses more than 50 ids', async () => {
    const ids = Array.from({ length: 51 }, () => randomUUID());
    expect((await post('/admin/listings/bulk', { action: 'hide', ids, reason: 'Too many' })).statusCode).toBe(400);
  });
});
