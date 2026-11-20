import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { AdminReportRow } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, fraudSignals, reports } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// Reports & flags with every target (admin close-out §7.2, R7, plan A4-1, D5): business and listing rows, resolve rules,
// the open count.

let app: FastifyInstance;
const sellers: TestSeller[] = [];
const adminIds: string[] = [];
let moderator: string;
let target: TestSeller;
let reporter: TestSeller;
let businessReportId: string;
let listingReportId: string;
let listingId: string;

const asAdmin = (method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${moderator}` }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  const m = await createTestAdmin('moderator');
  adminIds.push(m.id);
  moderator = m.token;
  target = await createTestSeller();
  reporter = await createTestSeller();
  sellers.push(target, reporter);

  const res = await app.inject({
    method: 'POST',
    url: `/businesses/${target.businessId}/reports`,
    headers: { authorization: `Bearer ${reporter.token}` },
    payload: { reason: 'scam_or_advance_payment', details: 'Asked for an advance' },
  });
  businessReportId = res.json().data.reportId;

  ({ id: listingId } = await insertTestListing(db, {
    businessId: target.businessId, userId: target.userId, kind: 'part', status: 'live', categoryId: null, title: 'Reported roller',
  }));
  const [lr] = await db
    .insert(reports)
    .values({ targetType: 'listing', targetId: listingId, reporterUserId: reporter.userId, reporterBusinessId: reporter.businessId, reason: 'fake_listing' })
    .returning({ id: reports.id });
  listingReportId = lr!.id;
  await db.insert(fraudSignals).values({ businessId: target.businessId, kind: 'reports_against', firstSeenAt: new Date(), lastSeenAt: new Date() });
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins(adminIds);
  await app?.close();
});

/** Every page of the queue for a target (the run's rows may sit past page 1 when other suites file reports). */
async function allRows(target: string): Promise<AdminReportRow[]> {
  const out: AdminReportRow[] = [];
  let cursor: string | null = null;
  do {
    const res = await asAdmin('GET', `/admin/reports?target=${target}${cursor ? `&cursor=${cursor}` : ''}`);
    expect(res.statusCode, res.body).toBe(200);
    out.push(...res.json().data.items);
    cursor = res.json().data.nextCursor;
  } while (cursor);
  return out;
}

describe('GET /admin/reports with business and listing targets', () => {
  it('counts open business and listing reports and open signals', async () => {
    const res = await asAdmin('GET', '/admin/reports/count');
    expect(res.statusCode).toBe(200);
    const counts = res.json().data;
    expect(Object.keys(counts).sort()).toEqual(['reports', 'signals']);
    expect(counts.reports).toBeGreaterThanOrEqual(2);
    expect(counts.signals).toBeGreaterThanOrEqual(1);
  });

  it('lists a business report with the business reported, and resolves it with an audit row', async () => {
    const row = (await allRows('business')).find((r) => r.id === businessReportId);
    expect(row).toMatchObject({
      target: 'business',
      targetId: target.businessId,
      business: { id: target.businessId },
      reason: 'scam_or_advance_payment',
      details: 'Asked for an advance',
      status: 'open',
      reporter: { businessId: reporter.businessId },
    });

    const res = await asAdmin('POST', `/admin/reports/${businessReportId}/resolve`, { outcome: 'actioned', note: 'Warned them' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toMatchObject({ id: businessReportId, status: 'actioned' });
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, businessReportId), eq(auditLog.action, 'report.resolve')));
    expect(audit).toHaveLength(1);
  });

  it('lists a listing report read-only: resolving it here is refused', async () => {
    const row = (await allRows('listing')).find((r) => r.id === listingReportId);
    expect(row).toMatchObject({
      target: 'listing',
      listing: { id: listingId, title: 'Reported roller', seller: { businessId: target.businessId } },
      status: 'open',
    });
    expect(typeof row!.listing!.ref).toBe('number');

    const res = await asAdmin('POST', `/admin/reports/${listingReportId}/resolve`, { outcome: 'dismissed', note: 'n/a' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('REPORT_RESOLVE_ELSEWHERE');
    const [still] = await db.select({ status: reports.status }).from(reports).where(eq(reports.id, listingReportId));
    expect(still!.status).toBe('open');
  });
});
