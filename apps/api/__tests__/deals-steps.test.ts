import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DealView } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { dealEvents, deals, listings, notifications, stockHolds, users } from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { finalizePrivatePhotos } from '../src/services/chat/private-photo.js';
import { syncReservation } from '../src/services/deals/holds.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { addTestMember, assertHeldInvariant, insertTestDeal } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// Notes, hand over, confirm received, cancel and cancel requests (plan L3-2, spec §9.1–§9.5, §8.1, §8.5, R17–R21; plan
// review C1 race and m3 photo retry). `assertHeldInvariant` after every stock move (Review focus 2).

vi.mock('../src/services/chat/private-photo.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/chat/private-photo.js')>();
  return {
    ...real,
    finalizePrivatePhotos: vi.fn(async (_businessId: string, keys: string[], dest: { kind: string; dealId?: string }) =>
      keys.map((_k, i) => `deal/${dest.dealId}/final-${i}.jpg`),
    ),
    privatePhotoUrl: vi.fn(async (key: string) => ({ url: `https://signed.test/${key}`, expiresAt: new Date(Date.now() + 300_000).toISOString() })),
  };
});
const finalize = vi.mocked(finalizePrivatePhotos);

let app: FastifyInstance;
let catalog: TestCatalog;
let seller: TestSeller;
let buyer: TestBusinessUser;
let moderator: { id: string; token: string };
const txApp = { db, log: { warn: () => undefined } } as unknown as TxApp;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const post = (token: string, id: string, path: string, payload: object = {}, key?: string) =>
  app.inject({
    method: 'POST',
    url: `/deals/${id}/${path}`,
    headers: { ...auth(token), ...(key ? { 'idempotency-key': key } : {}) },
    payload,
  });
const notes = (token: string, id: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/deals/${id}/notes`, headers: auth(token), payload });

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

/** A deal as accept leaves it: the hold, then `syncReservation` (reserved when nothing is left). */
async function dealOn(listingId: string, quantity: string, status: 'agreed' | 'handed_over' = 'agreed') {
  const d = await insertTestDeal({ listing: { id: listingId }, buyer, quantity, pricePerUnitPaise: 100_000, status });
  await runTx(txApp, (tx) => syncReservation(tx, listingId));
  return d;
}

async function listingRow(id: string) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row!;
}
async function dealRow(id: string) {
  const [row] = await db.select().from(deals).where(eq(deals.id, id));
  return row!;
}
const eventCount = async (dealId: string, code: string) =>
  (await db.select({ id: dealEvents.id }).from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.code, code as never)))).length;

async function notificationsOf(businessId: string, dealId: string) {
  const members = (await db.select({ id: users.id }).from(users).where(eq(users.businessId, businessId))).map((u) => u.id);
  return db
    .select({ type: notifications.type })
    .from(notifications)
    .where(and(inArray(notifications.userId, members), eq(notifications.dealId, dealId)));
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  buyer = await createTestBusinessUser();
  moderator = await createTestAdmin('moderator');
});

afterAll(async () => {
  await deleteTestBusinesses([seller?.businessId, buyer?.businessId].filter(Boolean) as string[]);
  if (seller) await deleteTestSellerExtras([seller]);
  await deleteTestAdmins([moderator?.id].filter(Boolean) as string[]);
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  await app?.close();
});

describe('hand over and confirm received (§9.2–§9.4)', () => {
  it('hand over sets the report window 48 h and auto-complete 72 h from the database clock; the buyer can’t hand over', async () => {
    const listingId = await listingOf('5');
    const d = await dealOn(listingId, '2');
    expect((await post(buyer.token, d.dealId, 'hand-over')).json().code).toBe('DEAL_TRANSITION_NOT_ALLOWED');

    const res = await post(seller.token, d.dealId, 'hand-over', { note: 'Packed in two crates' });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as DealView).status).toBe('handed_over');
    const { rows } = await db.execute(sql`
      SELECT extract(epoch FROM problem_deadline_at - handed_over_at)::int AS window,
             extract(epoch FROM auto_complete_at - handed_over_at)::int AS auto,
             extract(epoch FROM now() - handed_over_at) < 60 AS recent
      FROM deals WHERE id = ${d.dealId}`);
    expect(rows[0]).toEqual({ window: 48 * 3600, auto: 72 * 3600, recent: true });
    expect((await notificationsOf(buyer.businessId, d.dealId)).map((n) => n.type)).toEqual(['deal_handed_over']);
    expect(await notificationsOf(seller.businessId, d.dealId)).toEqual([]);
  });

  it('confirm converts the hold (quantity down, sold at 0); the seller can’t confirm; deal_completed to the seller only (P14)', async () => {
    const listingId = await listingOf('2');
    const d = await dealOn(listingId, '2', 'handed_over');
    expect((await listingRow(listingId)).status).toBe('reserved');

    expect((await post(seller.token, d.dealId, 'confirm-received')).json().code).toBe('DEAL_TRANSITION_NOT_ALLOWED');
    const res = await post(buyer.token, d.dealId, 'confirm-received');
    expect(res.statusCode).toBe(200);
    const deal = await dealRow(d.dealId);
    expect(deal.status).toBe('completed');
    expect(deal.completedHow).toBe('buyer_confirmed');
    const l = await listingRow(listingId);
    expect(Number(l.quantity)).toBe(0);
    expect(Number(l.heldQuantity)).toBe(0);
    expect(l.status).toBe('sold');
    const [hold] = await db.select().from(stockHolds).where(eq(stockHolds.dealId, d.dealId));
    expect(hold!.status).toBe('converted');
    await assertHeldInvariant(listingId);
    expect((await notificationsOf(seller.businessId, d.dealId)).map((n) => n.type)).toContain('deal_completed');
    expect((await notificationsOf(buyer.businessId, d.dealId)).map((n) => n.type)).not.toContain('deal_completed');
  });
});

describe('cancelling (§9.5)', () => {
  it('on agreed, either side alone releases the hold and the listing goes back to live', async () => {
    for (const [who, reason] of [
      [() => buyer.token, 'found_elsewhere'],
      [() => seller.token, 'stock_problem'],
    ] as const) {
      const listingId = await listingOf('3');
      const d = await dealOn(listingId, '3');
      expect((await listingRow(listingId)).status).toBe('reserved');
      // A reason from the other side's list is refused.
      expect((await post(who(), d.dealId, 'cancel', { reason: reason === 'stock_problem' ? 'found_elsewhere' : 'stock_problem' })).statusCode).toBe(400);
      const res = await post(who(), d.dealId, 'cancel', { reason });
      expect(res.statusCode).toBe(200);
      expect((await dealRow(d.dealId)).status).toBe('cancelled');
      const l = await listingRow(listingId);
      expect(l.status).toBe('live');
      expect(Number(l.heldQuantity)).toBe(0);
      await assertHeldInvariant(listingId);
    }
  });

  it('on handed_over: cancel refused; a request, the other side’s accept cancels (both) and releases; the requester can’t accept its own', async () => {
    const listingId = await listingOf('4');
    const d = await dealOn(listingId, '2', 'handed_over');
    expect((await post(buyer.token, d.dealId, 'cancel', { reason: 'found_elsewhere' })).json().code).toBe('DEAL_TRANSITION_NOT_ALLOWED');
    expect((await post(buyer.token, d.dealId, 'cancel-request/accept')).json().code).toBe('NO_CANCEL_REQUEST');

    expect((await post(buyer.token, d.dealId, 'cancel-request', { reason: 'no_longer_needed' })).statusCode).toBe(200);
    expect((await post(seller.token, d.dealId, 'cancel-request', {})).json().code).toBe('CANCEL_REQUEST_EXISTS');
    expect((await post(buyer.token, d.dealId, 'cancel-request/accept')).json().code).toBe('DEAL_TRANSITION_NOT_ALLOWED');

    const res = await post(seller.token, d.dealId, 'cancel-request/accept');
    expect(res.statusCode).toBe(200);
    const deal = await dealRow(d.dealId);
    expect(deal.status).toBe('cancelled');
    expect(deal.cancelledBySide).toBe('both');
    expect(deal.cancelReason).toBe('no_longer_needed');
    expect(Number((await listingRow(listingId)).heldQuantity)).toBe(0);
    await assertHeldInvariant(listingId);
  });

  it('either side clears a request: the requester withdraws, the other side declines', async () => {
    const listingId = await listingOf('4');
    const d = await dealOn(listingId, '1', 'handed_over');
    expect((await post(seller.token, d.dealId, 'cancel-request/clear')).json().code).toBe('NO_CANCEL_REQUEST');

    await post(seller.token, d.dealId, 'cancel-request', { reason: 'buyer_not_responding' });
    expect((await post(seller.token, d.dealId, 'cancel-request/clear')).statusCode).toBe(200);
    expect((await dealRow(d.dealId)).cancelRequestedSide).toBeNull();

    await post(buyer.token, d.dealId, 'cancel-request', {});
    expect((await post(seller.token, d.dealId, 'cancel-request/clear')).statusCode).toBe(200);
    const deal = await dealRow(d.dealId);
    expect(deal.status).toBe('handed_over');
    expect(deal.cancelRequestedSide).toBeNull();
    expect(await eventCount(d.dealId, 'cancel_request_withdrawn')).toBe(2);
    await assertHeldInvariant(listingId);
  });

  it('an admin removal cancels only agreed deals (listing_removed, system); handed-over ones continue', async () => {
    const listingId = await listingOf('5');
    const agreed = await dealOn(listingId, '2');
    const handed = await dealOn(listingId, '1', 'handed_over');
    const res = await app.inject({
      method: 'POST',
      url: `/admin/listings/${listingId}/remove`,
      headers: auth(moderator.token),
      payload: { reason: 'Counterfeit parts' },
    });
    expect(res.statusCode).toBe(200);
    const a = await dealRow(agreed.dealId);
    expect(a.status).toBe('cancelled');
    expect(a.cancelledBySide).toBe('system');
    expect(a.cancelReason).toBe('listing_removed');
    expect((await dealRow(handed.dealId)).status).toBe('handed_over');
    expect(Number((await listingRow(listingId)).heldQuantity)).toBe(1);
    await assertHeldInvariant(listingId);
  });
});

describe('notes (§9.1)', () => {
  it('a stale version → DEAL_STALE while hand over takes none; advance > total 400; a phone number is masked for the other side', async () => {
    const listingId = await listingOf('5');
    const d = await dealOn(listingId, '2');
    const v1 = (await dealRow(d.dealId)).version;

    const ok = await notes(buyer.token, d.dealId, { version: v1, paymentMethod: 'upi', text: 'Call me on +91 98765 43210' });
    expect(ok.statusCode).toBe(200);
    expect((await dealRow(d.dealId)).notesText).toBe('Call me on +91 98765 43210');
    const sellerView = (await app.inject({ method: 'GET', url: `/deals/${d.dealId}`, headers: auth(seller.token) })).json().data as DealView;
    expect(sellerView.notes.text).not.toContain('98765');
    expect(sellerView.notes.paymentMethod).toBe('upi');
    expect(sellerView.timeline.map((e) => e.code)).toContain('notes_changed');

    const stale = await notes(seller.token, d.dealId, { version: v1, fulfilment: 'pickup' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('DEAL_STALE');

    const total = (await dealRow(d.dealId)).totalPaise;
    const tooMuch = await notes(seller.token, d.dealId, { version: v1 + 1, advancePaise: (total + 1n).toString() });
    expect(tooMuch.statusCode).toBe(400);

    expect((await post(seller.token, d.dealId, 'hand-over')).statusCode).toBe(200);
  });

  it('a viewer is refused (403 VIEWER_READ_ONLY) on every deal write', async () => {
    const listingId = await listingOf('5');
    const d = await dealOn(listingId, '1', 'handed_over');
    const viewer = await addTestMember(buyer.businessId, 'viewer');
    const writes: Array<[string, string, object]> = [
      ['PATCH', 'notes', { version: 1, fulfilment: 'pickup' }],
      ['POST', 'photos/presign', { contentType: 'image/jpeg', contentLength: 1000 }],
      ['POST', 'hand-over', {}],
      ['POST', 'confirm-received', {}],
      ['POST', 'cancel', { reason: 'other' }],
      ['POST', 'cancel-request', {}],
      ['POST', 'cancel-request/accept', {}],
      ['POST', 'cancel-request/clear', {}],
      ['POST', 'problem', { category: 'damaged', description: 'Cracked housing on arrival' }],
    ];
    for (const [method, path, payload] of writes) {
      const res = await app.inject({ method: method as 'POST', url: `/deals/${d.dealId}/${path}`, headers: auth(viewer.token), payload });
      expect(res.statusCode, path).toBe(403);
      expect(res.json().code, path).toBe('VIEWER_READ_ONLY');
    }
    expect((await dealRow(d.dealId)).status).toBe('handed_over');
  });
});

describe('retries (P11, plan review m3)', () => {
  it('a retried hand over with the same key replays: one event', async () => {
    const listingId = await listingOf('5');
    const d = await dealOn(listingId, '1');
    const key = randomUUID();
    const first = await post(seller.token, d.dealId, 'hand-over', {}, key);
    const second = await post(seller.token, d.dealId, 'hand-over', {}, key);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(await eventCount(d.dealId, 'handed_over')).toBe(1);
  });

  it('a retried hand over with a photo and the same key replays without finalizing again', async () => {
    const listingId = await listingOf('5');
    const d = await dealOn(listingId, '1');
    const key = randomUUID();
    const body = { photoKey: `incoming-chat/${seller.businessId}/${randomUUID()}` };
    finalize.mockClear();
    const first = await post(seller.token, d.dealId, 'hand-over', body, key);
    expect(first.statusCode).toBe(200);
    expect((first.json().data as DealView).handover!.photo!.url).toContain(`deal/${d.dealId}/final-0.jpg`);
    const second = await post(seller.token, d.dealId, 'hand-over', body, key);
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(await eventCount(d.dealId, 'handed_over')).toBe(1);
    expect((await dealRow(d.dealId)).handoverPhotoKey).toBe(`deal/${d.dealId}/final-0.jpg`);
  });
});

describe('lock order (§8.5, plan review C1)', () => {
  it('confirm-received racing the seller’s quantity PATCH on the same listing settles both, no deadlock', async () => {
    for (let i = 0; i < 3; i++) {
      const listingId = await listingOf('5');
      const d = await dealOn(listingId, '2', 'handed_over');
      const [confirm, patch] = await Promise.all([
        post(buyer.token, d.dealId, 'confirm-received'),
        app.inject({ method: 'PATCH', url: `/listings/${listingId}`, headers: auth(seller.token), payload: { quantity: '6' } }),
      ]);
      for (const res of [confirm, patch]) {
        expect([200, 409], res.body).toContain(res.statusCode);
        expect(res.body).not.toContain('40P01');
      }
      await assertHeldInvariant(listingId);
      if (confirm.statusCode === 200) expect((await dealRow(d.dealId)).status).toBe('completed');
    }
  });
});
