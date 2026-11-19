import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import type { DealView } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, dealDisputes, deals, listings } from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { autoCompleteDeals } from '../src/services/deals/deal-jobs.js';
import { syncReservation } from '../src/services/deals/holds.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { assertHeldInvariant, insertTestDeal } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// Disputes (plan L3-3, spec §9.6, R20, §27 7): who may report and until when, a disputed deal never auto-completes,
// and each support outcome's stock move (completed converts; cancelled releases or converts by `stockReturned`;
// resumed restarts both timers), one audit row per resolve. `assertHeldInvariant` after each outcome.

let app: FastifyInstance;
let catalog: TestCatalog;
let seller: TestSeller;
let buyer: TestBusinessUser;
let support: { id: string; token: string };
const txApp = { db, log: { warn: () => undefined, error: () => undefined } } as unknown as TxApp;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const problem = (token: string, dealId: string, payload: object = { category: 'damaged', description: 'Two bearings arrived cracked' }) =>
  app.inject({ method: 'POST', url: `/deals/${dealId}/problem`, headers: auth(token), payload });
const resolve = (disputeId: string, payload: object) =>
  app.inject({ method: 'POST', url: `/admin/disputes/${disputeId}/resolve`, headers: auth(support.token), payload });

async function listingOf(quantity: string): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: catalog.motorsGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity,
  });
  return id;
}

/** A handed-over deal of `quantity` on a listing of `stock`, then the seller reports a problem. Returns ids. */
async function disputedDeal(stock: string, quantity: string) {
  const listingId = await listingOf(stock);
  const d = await insertTestDeal({ listing: { id: listingId }, buyer, quantity, pricePerUnitPaise: 100_000, status: 'handed_over' });
  await runTx(txApp, (tx) => syncReservation(tx, listingId));
  const res = await problem(seller.token, d.dealId, { category: 'payment_not_received', description: 'No payment after a week' });
  expect(res.statusCode).toBe(200);
  const view = res.json().data as DealView;
  return { listingId, dealId: d.dealId, disputeId: view.dispute!.id };
}

const dealRow = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0]!;
const listingRow = async (id: string) => (await db.select().from(listings).where(eq(listings.id, id)))[0]!;
const auditRows = (disputeId: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.entityId, disputeId), eq(auditLog.action, 'deal.dispute_resolve')));
const note = { internalNote: 'Checked both sides' };

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  buyer = await createTestBusinessUser();
  support = await createTestAdmin('support');
});

afterAll(async () => {
  if (support) await db.delete(auditLog).where(eq(auditLog.adminId, support.id));
  await deleteTestBusinesses([seller?.businessId, buyer?.businessId].filter(Boolean) as string[]);
  if (seller) await deleteTestSellerExtras([seller]);
  await deleteTestAdmins([support?.id].filter(Boolean) as string[]);
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  await app?.close();
});

describe('reporting a problem (§9.6)', () => {
  it('the buyer after the window → PROBLEM_WINDOW_CLOSED; the seller may still; timers stop; a disputed deal never auto-completes', async () => {
    const listingId = await listingOf('5');
    const d = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '2', pricePerUnitPaise: 100_000, status: 'handed_over' });
    await db.update(deals).set({ problemDeadlineAt: sql`now() - interval '1 minute'` }).where(eq(deals.id, d.dealId));

    const late = await problem(buyer.token, d.dealId);
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('PROBLEM_WINDOW_CLOSED');

    const short = await problem(seller.token, d.dealId, { category: 'other', description: 'too short' });
    expect(short.statusCode).toBe(400);

    const ok = await problem(seller.token, d.dealId);
    expect(ok.statusCode).toBe(200);
    const deal = await dealRow(d.dealId);
    expect(deal.status).toBe('disputed');
    expect(deal.autoCompleteAt).toBeNull();
    expect(deal.problemDeadlineAt).toBeNull();
    const [dispute] = await db.select().from(dealDisputes).where(eq(dealDisputes.dealId, d.dealId));
    expect(dispute).toMatchObject({ status: 'open', openedBySide: 'seller', category: 'damaged' });

    // Even with a due timer, the job's re-check (and completeDeal's status guard) leaves a disputed deal alone.
    await db.update(deals).set({ autoCompleteAt: sql`now() - interval '1 hour'` }).where(eq(deals.id, d.dealId));
    await autoCompleteDeals(txApp);
    expect((await dealRow(d.dealId)).status).toBe('disputed');
    await assertHeldInvariant(listingId);
  });
});

describe('support resolves (§9.2, §9.6)', () => {
  it('completed converts the hold', async () => {
    const { listingId, dealId, disputeId } = await disputedDeal('5', '2');
    expect((await resolve(disputeId, { outcome: 'completed', ...note })).statusCode).toBe(200);
    const deal = await dealRow(dealId);
    expect(deal.status).toBe('completed');
    expect(deal.completedHow).toBe('support');
    const l = await listingRow(listingId);
    expect(Number(l.quantity)).toBe(3);
    expect(Number(l.heldQuantity)).toBe(0);
    await assertHeldInvariant(listingId);
  });

  it('cancelled + stockReturned releases the hold and the listing is live again; false converts it', async () => {
    const back = await disputedDeal('2', '2');
    expect((await listingRow(back.listingId)).status).toBe('reserved');
    const res = await resolve(back.disputeId, { outcome: 'cancelled', stockReturned: true, messageToParties: 'Goods returned; deal closed.', ...note });
    expect(res.statusCode).toBe(200);
    const deal = await dealRow(back.dealId);
    expect(deal).toMatchObject({ status: 'cancelled', cancelReason: 'support_closed' });
    let l = await listingRow(back.listingId);
    expect(l.status).toBe('live');
    expect(Number(l.quantity)).toBe(2);
    await assertHeldInvariant(back.listingId);

    const gone = await disputedDeal('5', '2');
    expect((await resolve(gone.disputeId, { outcome: 'cancelled', stockReturned: false, ...note })).statusCode).toBe(200);
    expect((await dealRow(gone.dealId)).status).toBe('cancelled');
    l = await listingRow(gone.listingId);
    expect(Number(l.quantity)).toBe(3);
    expect(Number(l.heldQuantity)).toBe(0);
    await assertHeldInvariant(gone.listingId);
  });

  it('cancelled without stockReturned is 400 and changes nothing', async () => {
    const { dealId, disputeId } = await disputedDeal('5', '1');
    const res = await resolve(disputeId, { outcome: 'cancelled', ...note });
    expect(res.statusCode).toBe(400);
    expect((await dealRow(dealId)).status).toBe('disputed');
    expect(await auditRows(disputeId)).toHaveLength(0);
  });

  it('resumed restarts both timers from the resolve time; a second resolve → DISPUTE_NOT_OPEN; one audit row with before / after', async () => {
    const { listingId, dealId, disputeId } = await disputedDeal('5', '1');
    expect((await resolve(disputeId, { outcome: 'resumed', ...note })).statusCode).toBe(200);
    const { rows } = await db.execute(sql`
      SELECT status, extract(epoch FROM problem_deadline_at - now())::int AS window, extract(epoch FROM auto_complete_at - now())::int AS auto
      FROM deals WHERE id = ${dealId}`);
    const r = rows[0] as { status: string; window: number; auto: number };
    expect(r.status).toBe('handed_over');
    expect(Math.abs(r.window - 48 * 3600)).toBeLessThan(60);
    expect(Math.abs(r.auto - 72 * 3600)).toBeLessThan(60);

    const again = await resolve(disputeId, { outcome: 'completed', ...note });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('DISPUTE_NOT_OPEN');

    const audits = await auditRows(disputeId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.before).toMatchObject({ dealStatus: 'disputed', disputeStatus: 'open' });
    expect(audits[0]!.after).toMatchObject({ dealStatus: 'handed_over', disputeStatus: 'resolved', outcome: 'resumed', internalNote: 'Checked both sides' });
    await assertHeldInvariant(listingId);

    // After a resume either side can report again (§9.2).
    expect((await problem(buyer.token, dealId)).statusCode).toBe(200);
  });
});
