import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { EXPORT_SHEETS } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, businesses, users } from '../src/db/schema.js';
import { adminRateLimitKey } from '../src/lib/group-limit.js';
import { istToday, addDays } from '../src/lib/ist.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { insertTestDeal } from './_helpers/test-deals.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestListing,
  type TestSeller,
} from './_helpers/test-listings.js';
import { insertTestPartRequest } from './_helpers/test-part-requests.js';
import { insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// AD6 exports (admin close-out §10, R12, plan A4-3, D7): each sheet is its list for the same filters; roles; the
// contacts rule; formula cells; audit rows; the admin export limit.

const PLANTED = '9876543210';
const PLANTED_DEVANAGARI = '९८७६५४३२१०';

let app: FastifyInstance;
const sellers: TestSeller[] = [];
const adminIds: string[] = [];
const unitIds: string[] = [];
const token: Record<'super' | 'support' | 'operations' | 'moderator', string> = { super: '', support: '', operations: '', moderator: '' };
let supportId: string;
const run = `ExpRun${Date.now()}`;
let owner: TestSeller;
let buyer: TestSeller;

async function seller(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller(opts);
  sellers.push(s);
  return s;
}

const get = (t: string, url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${t}` } });

/** RFC 4180 rows (quoted fields, doubled quotes, CRLF), after the BOM. */
function parseCsv(body: string): string[][] {
  expect(body.charCodeAt(0)).toBe(0xfeff);
  const text = body.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function exportCsv(t: string, sheet: string, query: string): Promise<{ header: string[]; rows: string[][]; raw: string }> {
  const res = await get(t, `/admin/exports/${sheet}?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
  const [header, ...rows] = parseCsv(res.body);
  return { header: header!, rows, raw: res.body };
}

const column = (csv: { header: string[]; rows: string[][] }, name: string): string[] => {
  const i = csv.header.indexOf(name);
  expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
  return csv.rows.map((r) => r[i]!);
};

beforeAll(async () => {
  // This file's app keeps the real export limit (10 per 10 min per admin, D7): no admin here exports more than 7 times
  // except in the limit test itself (one app per file: closing an app ends the shared pool).
  const saved = process.env.GROUP_RATE_LIMIT_MAX;
  delete process.env.GROUP_RATE_LIMIT_MAX;
  app = await buildApp({ logger: false });
  process.env.GROUP_RATE_LIMIT_MAX = saved;
  for (const [k, role] of [['super', 'super_admin'], ['support', 'support'], ['operations', 'operations'], ['moderator', 'moderator']] as const) {
    const a = await createTestAdmin(role);
    adminIds.push(a.id);
    token[k] = a.token;
    if (k === 'support') supportId = a.id;
  }

  owner = await seller({ gst: true });
  buyer = await seller();
  await db.update(businesses).set({ tradeName: `${run} Owner Works`, email: `owner-${run}@example.test` }).where(eq(businesses.id, owner.businessId));
  await db.update(businesses).set({ tradeName: `=HYPERLINK("x") ${run}` }).where(eq(businesses.id, buyer.businessId));
  // The planted number as the owner's login phone (removed with the business).
  await db.update(users).set({ phone: `+91${PLANTED}` }).where(eq(users.id, owner.userId));

  const categoryId = owner.cleanup.categoryIds[0]!;
  const live = await insertTestListing(db, {
    businessId: owner.businessId, userId: owner.userId, kind: 'part', status: 'live', categoryId, title: `${run} roller`, quantity: '10',
  });
  await insertTestListing(db, { businessId: owner.businessId, userId: owner.userId, kind: 'part', status: 'paused', categoryId, title: `${run} paused` });
  await insertTestDeal({ listing: live, buyer, quantity: '1', pricePerUnitPaise: 12_345, status: 'agreed' });
  await insertTestDeal({ listing: live, buyer, quantity: '2', pricePerUnitPaise: 12_345, status: 'completed' });

  const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, categoryId, quantity: 2 });
  const base = { listingId, renterBusinessId: buyer.businessId, ownerBusinessId: owner.businessId, userId: buyer.userId };
  await insertTestBooking({ ...base, startDate: addDays(istToday(), 5), siteAddress: `Plot 9, call ${PLANTED}` });
  await insertTestBooking({ ...base, status: 'confirmed', startDate: addDays(istToday(), 9) });

  const unit = await createTestMachineUnit();
  unitIds.push(unit.id);
  const pr = { businessId: buyer.businessId, userId: buyer.userId, categoryId, kind: 'machine' as const, unitId: unit.id };
  await insertTestPartRequest({ ...pr, name: `Loom call ${PLANTED}`, note: 'Secret note', budgetPerUnitPaise: 99_900 });
  await insertTestPartRequest({ ...pr, name: 'Second loom', status: 'closed' });
});

afterAll(async () => {
  for (const id of adminIds) await app.redis?.del(adminRateLimitKey('admin_export', id));
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestUnits(unitIds);
  await deleteTestAdmins(adminIds);
  await app?.close();
});

describe('GET /admin/exports/:sheet = the list for the same filters', () => {
  it('businesses', async () => {
    const list = await get(token.support, `/admin/businesses?search=${run}`);
    const ids = list.json().data.rows.map((r: { id: string }) => r.id).sort();
    expect(ids).toHaveLength(2);
    const csv = await exportCsv(token.support, 'businesses', `search=${run}`);
    expect(column(csv, 'Business id').sort()).toEqual(ids);
  });

  it('listings', async () => {
    const q = `businessId=${owner.businessId}&status=live,paused&kind=part`;
    const list = await get(token.support, `/admin/listings?${q}`);
    const refs = list.json().data.rows.map((r: { ref: number }) => `#${r.ref}`).sort();
    expect(refs).toHaveLength(2);
    expect(column(await exportCsv(token.support, 'listings', q), 'Ref').sort()).toEqual(refs);
    const liveOnly = await exportCsv(token.support, 'listings', `businessId=${owner.businessId}&status=live&kind=part`);
    expect(liveOnly.rows).toHaveLength(1);
  });

  it('deals', async () => {
    const list = await get(token.support, `/admin/deals?search=${run}`);
    const refs = list.json().data.rows.map((r: { ref: number }) => `#${r.ref}`).sort();
    expect(refs).toHaveLength(2);
    const csv = await exportCsv(token.operations, 'deals', `search=${run}`);
    expect(column(csv, 'Ref').sort()).toEqual(refs);
    expect(column(csv, 'Price per unit (INR)')).toEqual(['123.45', '123.45']);
  });

  it('rental bookings', async () => {
    const list = await get(token.support, `/admin/rental-bookings?businessId=${owner.businessId}`);
    const refs = list.json().data.rows.map((r: { ref: number }) => `#${r.ref}`).sort();
    expect(refs).toHaveLength(2);
    const csv = await exportCsv(token.operations, 'rental_bookings', `businessId=${owner.businessId}`);
    expect(column(csv, 'Ref').sort()).toEqual(refs);
    expect(csv.raw).not.toContain(PLANTED);
    expect(csv.raw).not.toContain('Plot 9');
  });

  it('part requests, the name masked, never the note or budget', async () => {
    const list = await get(token.support, `/admin/part-requests?businessId=${buyer.businessId}`);
    const refs = list.json().data.rows.map((r: { ref: number }) => `#${r.ref}`).sort();
    expect(refs).toHaveLength(2);
    const csv = await exportCsv(token.moderator, 'part_requests', `businessId=${buyer.businessId}`);
    expect(column(csv, 'Ref').sort()).toEqual(refs);
    expect(csv.raw).not.toContain(PLANTED);
    expect(csv.raw).not.toContain('Secret note');
    expect(csv.raw).not.toContain('999.00');
  });

  it('names no notes, messages, address, PAN or budget in any header', async () => {
    const empty: Record<string, string> = {
      businesses: `search=${randomUUID()}`,
      listings: `businessId=${randomUUID()}`,
      deals: `search=${randomUUID()}`,
      rental_bookings: `businessId=${randomUUID()}`,
      part_requests: `businessId=${randomUUID()}`,
    };
    for (const sheet of EXPORT_SHEETS) {
      const { header } = await exportCsv(token.super, sheet, `${empty[sheet]}&includeContacts=1`);
      for (const h of header) expect(h, `${sheet}: ${h}`).not.toMatch(/\b(notes?|messages?|address|pan|budget)\b/i);
    }
  });
});

describe('roles, contacts and cells', () => {
  it('lets support export listings and refuses operations', async () => {
    expect((await get(token.support, `/admin/exports/listings?businessId=${owner.businessId}`)).statusCode).toBe(200);
    expect((await get(token.operations, `/admin/exports/listings?businessId=${owner.businessId}`)).statusCode).toBe(403);
  });

  it('adds owner phone and email only for a super admin who asks', async () => {
    const asSupport = await exportCsv(token.support, 'businesses', `search=${run}&includeContacts=1`);
    expect(asSupport.header).not.toContain('Owner phone');
    expect(asSupport.header).not.toContain('Email');
    expect(asSupport.raw).not.toContain(PLANTED);
    expect(asSupport.raw).not.toContain(PLANTED_DEVANAGARI);
    expect(asSupport.raw).not.toContain(`owner-${run}`);
    const audits = await db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.adminId, supportId), eq(auditLog.action, 'export.create'), eq(auditLog.entityId, 'businesses')));
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.every((a) => (a.after as { includeContacts: boolean }).includeContacts === false)).toBe(true);

    const superNoAsk = await exportCsv(token.super, 'businesses', `search=${run}`);
    expect(superNoAsk.header).not.toContain('Owner phone');
    expect(superNoAsk.raw).not.toContain(PLANTED);

    const asSuper = await exportCsv(token.super, 'businesses', `search=${run}&includeContacts=1`);
    expect(asSuper.header.slice(-2)).toEqual(['Owner phone', 'Email']);
    // A leading + is neutralised like any formula start (`lib/csv.ts`).
    expect(column(asSuper, 'Owner phone')).toContain(`'+91${PLANTED}`);
    expect(column(asSuper, 'Email')).toContain(`owner-${run}@example.test`);
  });

  it("neutralises a formula in a trade name with a leading '", async () => {
    const csv = await exportCsv(token.support, 'businesses', `search=${run}`);
    expect(column(csv, 'Trade name')).toContain(`'=HYPERLINK("x") ${run}`);
  });

  it('writes one export.create row per export with its filters and row count', async () => {
    const a = await createTestAdmin('moderator');
    adminIds.push(a.id);
    const csv = await exportCsv(a.token, 'listings', `businessId=${owner.businessId}&status=live,paused&kind=part`);
    const rows = await db
      .select({ entityType: auditLog.entityType, entityId: auditLog.entityId, after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.adminId, a.id), eq(auditLog.action, 'export.create')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: 'export',
      entityId: 'listings',
      after: {
        filters: { businessId: owner.businessId, status: ['live', 'paused'], kind: 'part' },
        rowCount: csv.rows.length,
        includeContacts: false,
      },
    });
  });
});

describe('the admin export limit (D7)', () => {
  it('refuses the 11th export in 10 minutes', async () => {
    const a = await createTestAdmin('support');
    adminIds.push(a.id);
    const url = `/admin/exports/listings?businessId=${randomUUID()}`;
    for (let i = 0; i < 10; i++) expect((await get(a.token, url)).statusCode, `export ${i + 1}`).toBe(200);
    const res = await get(a.token, url);
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('RATE_LIMITED');
  });
});
