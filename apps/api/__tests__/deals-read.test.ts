import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import type { DealView, DealsPage } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { deals } from '../src/db/schema.js';
import { withdrawContactConsents } from '../src/services/consent/contact-consent.service.js';
import { dealActions } from '../src/services/deals/deal-actions.js';
import { dealsYourTurnCount } from '../src/services/deals/deal-read.service.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { addTestMember, insertTestDeal } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// Deal reads and actions per side (plan L3-1, spec §9.1–§9.2, §6.6): the `dealActions` table, outsiders 404, a viewer
// reads with no actions, tab counts and the Deals badge, and the Deal record's contact block (L1's `contactState`
// through the real share route: both ticks reveal the numbers; a withdraw hides them).

let app: FastifyInstance;
let catalog: TestCatalog;
let seller: TestSeller;
let seller2: TestSeller;
let buyer: TestBusinessUser;
let buyer2: TestBusinessUser;
let outsider: TestBusinessUser;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const getDeal = (token: string, id: string) => app.inject({ method: 'GET', url: `/deals/${id}`, headers: auth(token) });

async function listingOf(s: TestSeller, quantity: string): Promise<{ id: string }> {
  return insertTestListing(db, {
    businessId: s.businessId,
    userId: s.userId,
    kind: 'part',
    categoryId: catalog.motorsGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity,
  });
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  seller2 = await createTestSeller({ machineCategoryId: catalog.categoryId });
  buyer = await createTestBusinessUser();
  buyer2 = await createTestBusinessUser();
  outsider = await createTestBusinessUser();
});

afterAll(async () => {
  await deleteTestBusinesses([seller, seller2, buyer, buyer2, outsider].filter(Boolean).map((b) => b!.businessId));
  await deleteTestSellerExtras([seller, seller2].filter(Boolean) as TestSeller[]);
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  await app?.close();
});

describe('dealActions (§9.2, pure)', () => {
  const now = new Date('2026-11-19T10:00:00Z');
  const before = new Date('2026-11-20T10:00:00Z');
  const after = new Date('2026-11-18T10:00:00Z');
  const deal = (status: Parameters<typeof dealActions>[0]['status'], extra: Partial<Parameters<typeof dealActions>[0]> = {}) => ({
    status,
    problemDeadlineAt: null,
    cancelRequestedSide: null,
    ...extra,
  });

  it.each([
    ['agreed', 'seller', 'owner', {}, ['hand_over', 'cancel', 'edit_notes']],
    ['agreed', 'buyer', 'sales', {}, ['cancel', 'edit_notes']],
    ['agreed', 'seller', 'viewer', {}, []],
    ['handed_over', 'buyer', 'owner', { problemDeadlineAt: before }, ['confirm_received', 'report_problem', 'edit_notes', 'request_cancel']],
    ['handed_over', 'buyer', 'owner', { problemDeadlineAt: after }, ['confirm_received', 'edit_notes', 'request_cancel']],
    ['handed_over', 'seller', 'listing_manager', { problemDeadlineAt: after }, ['report_problem', 'edit_notes', 'request_cancel']],
    ['handed_over', 'buyer', 'owner', { problemDeadlineAt: before, cancelRequestedSide: 'buyer' }, ['confirm_received', 'report_problem', 'edit_notes', 'clear_cancel_request']],
    ['handed_over', 'seller', 'owner', { cancelRequestedSide: 'buyer' }, ['report_problem', 'edit_notes', 'accept_cancel_request', 'clear_cancel_request']],
    ['handed_over', 'buyer', 'viewer', { problemDeadlineAt: before }, []],
    ['disputed', 'buyer', 'owner', {}, []],
    ['disputed', 'seller', 'owner', {}, []],
    ['completed', 'seller', 'owner', {}, []],
    ['cancelled', 'buyer', 'owner', {}, []],
  ] as const)('%s · %s · %s %o → %o', (status, side, role, extra, expected) => {
    expect(dealActions(deal(status, extra), side, role, now)).toEqual(expected);
  });
});

describe('GET /deals/:id (party checks)', () => {
  it('404 DEAL_NOT_FOUND for a third business; a viewer reads the deal with no actions', async () => {
    const listing = await listingOf(seller, '10');
    const d = await insertTestDeal({ listing, buyer, quantity: '2', pricePerUnitPaise: 50_000 });

    const outside = await getDeal(outsider.token, d.dealId);
    expect(outside.statusCode).toBe(404);
    expect(outside.json().code).toBe('DEAL_NOT_FOUND');

    const viewer = await addTestMember(seller.businessId, 'viewer');
    const res = await getDeal(viewer.token, d.dealId);
    expect(res.statusCode).toBe(200);
    const view = res.json().data as DealView;
    expect(view.side).toBe('seller');
    expect(view.memberRole).toBe('viewer');
    expect(view.actions).toEqual([]);
    expect(view.totalPaise).toBe('100000');
    expect(view.quantity).toBe('2');

    const owner = (await getDeal(seller.token, d.dealId)).json().data as DealView;
    expect(owner.actions).toEqual(expect.arrayContaining(['hand_over', 'cancel', 'edit_notes']));
    expect(owner.yourTurn).toBe(true);
  });
});

describe('GET /deals (tabs, counts) and the Deals badge', () => {
  it('counts per tab and "your turn": agreed for the seller, handed_over for the buyer, a cancel request for the other side', async () => {
    const listing = await listingOf(seller2, '20');
    const agreed = await insertTestDeal({ listing, buyer: buyer2, quantity: '1', pricePerUnitPaise: 10_000 });
    const handed = await insertTestDeal({ listing, buyer: buyer2, quantity: '1', pricePerUnitPaise: 10_000, status: 'handed_over' });
    await insertTestDeal({ listing, buyer: buyer2, quantity: '1', pricePerUnitPaise: 10_000, status: 'completed' });
    await insertTestDeal({ listing, buyer: buyer2, quantity: '1', pricePerUnitPaise: 10_000, status: 'cancelled' });

    const page = (await app.inject({ method: 'GET', url: '/deals?tab=active&side=buying', headers: auth(buyer2.token) })).json()
      .data as DealsPage;
    expect(page.counts).toEqual({ active: 2, completed: 1, cancelled: 1, yourTurn: 1 });
    expect(page.items.map((r) => r.id).sort()).toEqual([agreed.dealId, handed.dealId].sort());
    expect(page.items.find((r) => r.id === handed.dealId)!.yourTurn).toBe(true);

    const selling = (await app.inject({ method: 'GET', url: '/deals?tab=completed&side=selling', headers: auth(seller2.token) })).json()
      .data as DealsPage;
    expect(selling.items).toHaveLength(1);
    expect(selling.counts.yourTurn).toBe(1);

    expect(await dealsYourTurnCount(db, { userId: seller2.userId, businessId: seller2.businessId })).toBe(1);
    expect(await dealsYourTurnCount(db, { userId: buyer2.userId, businessId: buyer2.businessId })).toBe(1);

    // The buyer asks to cancel the handed-over deal: now it waits on the seller.
    await db.update(deals).set({ cancelRequestedSide: 'buyer', cancelRequestedAt: sql`now()` }).where(eq(deals.id, handed.dealId));
    expect(await dealsYourTurnCount(db, { userId: seller2.userId, businessId: seller2.businessId })).toBe(2);
    expect(await dealsYourTurnCount(db, { userId: buyer2.userId, businessId: buyer2.businessId })).toBe(0);
  });
});

describe('contact block on the Deal record (§6.6, R6)', () => {
  it('both ticks reveal the numbers (never to a viewer); a withdraw of the number hides it', async () => {
    const listing = await listingOf(seller, '10');
    const d = await insertTestDeal({ listing, buyer, quantity: '1', pricePerUnitPaise: 50_000 });
    const sellerViewer = await addTestMember(seller.businessId, 'viewer');
    const share = (token: string) => app.inject({ method: 'POST', url: `/threads/${d.threadId}/share-contact`, headers: auth(token) });

    let b = (await getDeal(buyer.token, d.dealId)).json().data as DealView;
    expect(b.contact).toMatchObject({ mine: false, theirs: false, revealed: false, number: null, canTick: true });
    expect(b.actions).toContain('share_contact');

    expect((await share(buyer.token)).statusCode).toBe(200);
    b = (await getDeal(buyer.token, d.dealId)).json().data as DealView;
    expect(b.contact).toMatchObject({ mine: true, revealed: false, number: null, canTick: false });
    expect(b.actions).not.toContain('share_contact');

    expect((await share(seller.token)).statusCode).toBe(200);
    b = (await getDeal(buyer.token, d.dealId)).json().data as DealView;
    expect(b.contact).toMatchObject({ mine: true, theirs: true, revealed: true, number: seller.phone });
    const s = (await getDeal(seller.token, d.dealId)).json().data as DealView;
    expect(s.contact.number).toBe(buyer.phone);
    const v = (await getDeal(sellerViewer.token, d.dealId)).json().data as DealView;
    expect(v.contact).toMatchObject({ revealed: true, number: null, canTick: false });

    // The seller's number is withdrawn (replaced): the reveal stays, the number goes.
    await db.transaction((tx) => withdrawContactConsents(tx, seller.businessId, seller.phone, 'number_replaced'));
    b = (await getDeal(buyer.token, d.dealId)).json().data as DealView;
    expect(b.contact).toMatchObject({ theirs: false, revealed: true, number: null });
  });
});
