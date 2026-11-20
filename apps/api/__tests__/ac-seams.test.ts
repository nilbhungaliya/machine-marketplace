import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, dealReviews, reports } from '../src/db/schema.js';
import type { CsvCell } from '../src/lib/csv.js';
import { istToday } from '../src/lib/ist.js';
import { runCsvExport } from '../src/services/exports/run-export.js';
import { istMinute, rupees } from '../src/services/exports/format.js';
import { reportAgainstSql } from '../src/services/reports/report-subject.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { insertTestDeal, insertTestThread } from './_helpers/test-deals.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestListing,
  type TestSeller,
} from './_helpers/test-listings.js';
import { insertTestPartRequest } from './_helpers/test-part-requests.js';

// Admin close-out plan C0-4: the export runner (cap, BOM, formula cells, the `export.create` audit row with masked
// filters), the IST minute format and report attribution (`reportAgainstSql`).

let app: FastifyInstance;
let admin: { id: string; token: string };
let x: TestSeller;
let y: TestSeller;
const unitIds: string[] = [];

// The test route's spec, swapped per case.
let spec: { rows: CsvCell[][]; cap: number; filters: Record<string, unknown> } = { rows: [], cap: 2, filters: {} };

const PLANTED = '9876543210';
const PLANTED_DEVANAGARI = '९८७६५४३२१०';

beforeAll(async () => {
  app = await buildApp({ logger: false });
  // One row per page, so the keyset loop runs more than once.
  app.get('/__test/export', async (_request, reply) => {
    const { rows, cap, filters } = spec;
    await runCsvExport<number>(app, reply, {
      adminId: admin.id,
      sheet: 'listings',
      filters,
      header: ['Ref', 'Title'],
      cap,
      count: async () => rows.length,
      page: async (after) => {
        const i = after ?? 0;
        return { rows: rows.slice(i, i + 1), next: i + 1 < rows.length ? i + 1 : null };
      },
    });
    return reply;
  });
  admin = await createTestAdmin('super_admin');
  x = await createTestSeller();
  y = await createTestSeller();
});

afterAll(async () => {
  await deleteTestBusinesses([x?.businessId, y?.businessId].filter(Boolean) as string[]);
  await deleteTestSellerExtras([x, y].filter(Boolean));
  await deleteTestUnits(unitIds);
  await deleteTestAdmins([admin.id]);
  await app.close();
});

const exportRows = () =>
  db.select().from(auditLog).where(and(eq(auditLog.adminId, admin.id), eq(auditLog.action, 'export.create')));

describe('runCsvExport (R12, plan D10)', () => {
  it('refuses an export over the cap with the count, and writes no audit row', async () => {
    spec = { rows: [['1', 'a'], ['2', 'b'], ['3', 'c']], cap: 2, filters: { status: 'live' } };
    const res = await app.inject({ method: 'GET', url: '/__test/export' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('EXPORT_TOO_LARGE');
    expect(res.json().details.total).toBe(3);
    expect(await exportRows()).toHaveLength(0);
  });

  it('streams one BOM, the header and every page, neutralises formulas and audits counts, never cells', async () => {
    spec = { rows: [['#500001', '=1+1'], ['#500002', 'Secret cell value']], cap: 2, filters: { status: 'live' } };
    const res = await app.inject({ method: 'GET', url: '/__test/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="listings-${istToday()}.csv"`);
    const body = res.body;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.charCodeAt(1)).not.toBe(0xfeff);
    expect(body.slice(1)).toBe("Ref,Title\r\n#500001,'=1+1\r\n#500002,Secret cell value\r\n");

    const rows = await exportRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityType).toBe('export');
    expect(rows[0]!.entityId).toBe('listings');
    expect(rows[0]!.after).toEqual({ filters: { status: 'live' }, rowCount: 2, includeContacts: false });
    expect(JSON.stringify(rows[0])).not.toContain('Secret cell value');
    await db.delete(auditLog).where(eq(auditLog.id, rows[0]!.id));
  });

  it('masks contact details in the filters it audits (ASCII and Devanagari digits)', async () => {
    spec = { rows: [['#1', 'x']], cap: 2, filters: { search: '98765 43210', also: [PLANTED_DEVANAGARI], nested: { q: PLANTED } } };
    expect((await app.inject({ method: 'GET', url: '/__test/export' })).statusCode).toBe(200);
    const rows = await exportRows();
    expect(rows).toHaveLength(1);
    const stored = JSON.stringify(rows[0]!.after);
    for (const planted of [PLANTED, '98765 43210', PLANTED_DEVANAGARI]) expect(stored).not.toContain(planted);
    await db.delete(auditLog).where(eq(auditLog.id, rows[0]!.id));
  });
});

describe('format (§10)', () => {
  it('writes times as IST minutes across the date boundary', () => {
    expect(istMinute('2026-11-20T18:31:00Z')).toBe('2026-11-21 00:01');
    expect(istMinute(new Date('2026-11-20T18:29:00Z'))).toBe('2026-11-20 23:59');
  });

  it('writes paise as rupees with two decimals', () => {
    expect(rupees(123450)).toBe('1234.50');
    expect(rupees(5n)).toBe('0.05');
    expect(rupees(null)).toBe('');
  });
});

describe('reportAgainstSql (§7)', () => {
  it('resolves each target to the business reported, and a conversation report to the other party', async () => {
    const yListing = await insertTestListing(db, { businessId: y.businessId, userId: y.userId, kind: 'part', categoryId: y.cleanup.categoryIds[0]! });
    const unit = await createTestMachineUnit();
    unitIds.push(unit.id);
    const yRequest = await insertTestPartRequest({
      businessId: y.businessId,
      userId: y.userId,
      categoryId: y.cleanup.categoryIds[0]!,
      kind: 'machine',
      unitId: unit.id,
    });
    // X buys from Y: the thread's buyer is X, the seller Y; Y (seller side) reviews X.
    const thread = await insertTestThread({ listingId: yListing.id, buyerBusinessId: x.businessId, buyerUserId: x.userId });
    const deal = await insertTestDeal({ listing: yListing, buyer: x, quantity: '1', pricePerUnitPaise: 10_000, status: 'completed' });
    const [review] = await db
      .insert(dealReviews)
      .values({
        dealId: deal.dealId,
        reviewerSide: 'seller',
        reviewerBusinessId: y.businessId,
        reviewedBusinessId: x.businessId,
        reviewerUserId: y.userId,
        rCommunication: 4,
        rPayment: 4,
        rPickup: 4,
        publishDueAt: sql`now()`,
      })
      .returning({ id: dealReviews.id });

    const byX = { reporterUserId: x.userId, reporterBusinessId: x.businessId, reason: 'other' };
    const inserted = await db
      .insert(reports)
      .values([
        { ...byX, targetType: 'business', targetId: y.businessId },
        { ...byX, targetType: 'listing', targetId: yListing.id },
        { ...byX, targetType: 'part_request', targetId: yRequest.id },
        { ...byX, targetType: 'review', targetId: review!.id },
        { ...byX, targetType: 'conversation', targetId: thread.id },
        { reporterUserId: y.userId, reporterBusinessId: y.businessId, reason: 'other', targetType: 'conversation', targetId: thread.id },
        { ...byX, targetType: 'user', targetId: y.userId },
      ])
      .returning({ id: reports.id });
    const ids = inserted.map((r) => r.id);

    const rows = await db
      .select({ id: reports.id, against: sql<string | null>`${reportAgainstSql('reports')}` })
      .from(reports)
      .where(inArray(reports.id, ids));
    const against = new Map(rows.map((r) => [r.id, r.against]));
    expect(ids.map((id) => against.get(id))).toEqual([
      y.businessId,
      y.businessId,
      y.businessId,
      y.businessId,
      y.businessId, // filed by X: against Y, never X
      x.businessId, // filed by Y on the same thread: against X
      null,
    ]);
    await db.delete(reports).where(inArray(reports.id, ids));
  });
});
