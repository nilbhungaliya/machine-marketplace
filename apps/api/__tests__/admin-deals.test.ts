import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import type { AdminDealDetail, AdminDisputeDetail } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, dealDisputes, deals } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { insertTestDeal } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// Admin Deals and Disputes APIs (plan L3-3, spec §16.1–§16.2): roles, and the deal detail carries the structured notes
// but never the free text.

let app: FastifyInstance;
let catalog: TestCatalog;
let seller: TestSeller;
let buyer: TestBusinessUser;
const admins: Record<'support' | 'operations' | 'moderator', { id: string; token: string }> = {} as never;
const PLANTED = 'PLANTED-NOTE call 9876543210';

const as = (role: keyof typeof admins, method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${admins[role].token}` }, ...(payload ? { payload } : {}) });

let dealId: string;
let disputeId: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  buyer = await createTestBusinessUser();
  for (const role of ['support', 'operations', 'moderator'] as const) admins[role] = await createTestAdmin(role);
  const { id: listingId } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: catalog.motorsGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity: '5',
  });
  const d = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '1', pricePerUnitPaise: 100_000, status: 'disputed' });
  dealId = d.dealId;
  await db.update(deals).set({ notesText: PLANTED, paymentMethod: 'bank', advancePaise: 20_000n }).where(eq(deals.id, dealId));
  const [row] = await db
    .insert(dealDisputes)
    .values({ dealId, openedBySide: 'buyer', openedByUserId: buyer.userId, category: 'damaged', description: 'Housing cracked on arrival' })
    .returning({ id: dealDisputes.id });
  disputeId = row!.id;
});

afterAll(async () => {
  const ids = Object.values(admins).map((a) => a.id);
  if (ids.length) await db.delete(auditLog).where(inArray(auditLog.adminId, ids));
  await deleteTestBusinesses([seller?.businessId, buyer?.businessId].filter(Boolean) as string[]);
  if (seller) await deleteTestSellerExtras([seller]);
  await deleteTestAdmins(ids);
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  await app?.close();
});

describe('roles (§16.1)', () => {
  it('deals: support and operations read, a moderator gets 403', async () => {
    for (const role of ['support', 'operations'] as const) {
      expect((await as(role, 'GET', '/admin/deals?status=disputed')).statusCode).toBe(200);
      expect((await as(role, 'GET', `/admin/deals/${dealId}`)).statusCode).toBe(200);
    }
    expect((await as('moderator', 'GET', '/admin/deals')).statusCode).toBe(403);
  });

  it('disputes: support only; operations 403 on resolve', async () => {
    expect((await as('operations', 'GET', '/admin/disputes')).statusCode).toBe(403);
    expect((await as('operations', 'POST', `/admin/disputes/${disputeId}/resolve`, { outcome: 'completed', internalNote: 'Fine' })).statusCode).toBe(403);
    expect((await as('support', 'GET', '/admin/disputes/count')).json().data.open).toBeGreaterThanOrEqual(1);
    const list = (await as('support', 'GET', '/admin/disputes?status=open')).json().data;
    expect(list.rows.map((r: { id: string }) => r.id)).toContain(disputeId);
    const detail = (await as('support', 'GET', `/admin/disputes/${disputeId}`)).json().data as AdminDisputeDetail;
    expect(detail.description).toBe('Housing cracked on arrival');
    expect(detail.deal.id).toBe(dealId);
  });
});

describe('deal detail (§16.1)', () => {
  it('shows structured notes and the hold, never the notes text', async () => {
    const res = await as('operations', 'GET', `/admin/deals/${dealId}`);
    expect(res.body).not.toContain('PLANTED-NOTE');
    expect(res.body).not.toContain('9876543210');
    const d = res.json().data as AdminDealDetail;
    expect(d.notes).toEqual({ paymentMethod: 'bank', advancePaise: '20000', fulfilment: null, expectedOn: null, hasText: true });
    expect(d.hold).toEqual({ status: 'active', quantity: '1' });
    expect(d.openDisputeId).toBe(disputeId);
    expect(d.disputes.map((x) => x.id)).toEqual([disputeId]);
    const disputeDetail = await as('support', 'GET', `/admin/disputes/${disputeId}`);
    expect(disputeDetail.body).not.toContain('PLANTED-NOTE');
  });

  it('support resolves (200) and the list moves it out of open', async () => {
    const res = await as('support', 'POST', `/admin/disputes/${disputeId}/resolve`, { outcome: 'completed', internalNote: 'Buyer confirmed by phone' });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as AdminDisputeDetail).status).toBe('resolved');
    const { rows } = await db.execute(sql`SELECT status FROM deals WHERE id = ${dealId}`);
    expect((rows[0] as { status: string }).status).toBe('completed');
  });
});
