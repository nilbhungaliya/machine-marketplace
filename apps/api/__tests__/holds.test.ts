import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { ListingStatus } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { listingStatusHistory, listings, stockHolds } from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { availableOf, convertHold, placeHold, releaseHold, syncReservation } from '../src/services/deals/holds.js';
import { applySystemTransition } from '../src/services/listings/listing-lifecycle.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { assertHeldInvariant, insertTestDeal } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestListingOptions, type TestSeller } from './_helpers/test-listings.js';

// Holds, syncReservation and the listing transitions F6 + F7 adds (plan C1-1, spec §8.1–§8.3, §27 1–3, 9): the held
// quantity and status move together, a sell-out lands wherever the listing is, leaving `reserved` stores `live`, and
// the stock moves never take the seller's business lock. `assertHeldInvariant` after every case (Review focus 2).

let app: FastifyInstance;
let catalog: TestCatalog;
let seller: TestSeller;
let buyer: TestBusinessUser;
let moderator: { id: string; token: string };
const txApp = { db, log: { warn: () => undefined } } as unknown as TxApp;

const sellerAuth = () => ({ authorization: `Bearer ${seller.token}` });
const adminAuth = () => ({ authorization: `Bearer ${moderator.token}` });

async function listingOf(quantity: string, extra: Partial<TestListingOptions> = {}): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: catalog.motorsGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity,
    ...extra,
  });
  return id;
}

async function rowOf(id: string) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row!;
}

/** An `agreed` deal with its active hold (fixture SQL, `held_quantity += quantity`). */
const dealOf = (listingId: string, quantity: string) =>
  insertTestDeal({ listing: { id: listingId }, buyer, quantity, pricePerUnitPaise: 100_000 }).then((d) => d.dealId);

/** A deal row without a hold, for `placeHold` (the deal is inserted first, then its hold: textile D3). */
async function bareDeal(listingId: string): Promise<string> {
  const { dealId } = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '1', pricePerUnitPaise: 100_000, status: 'cancelled' });
  await db.delete(stockHolds).where(eq(stockHolds.dealId, dealId));
  return dealId;
}

const place = async (listingId: string, quantity: string) => {
  const dealId = await bareDeal(listingId);
  await runTx(txApp, async (tx) => placeHold(tx, await rowOf(listingId), dealId, quantity));
  return dealId;
};
const sync = (id: string) => runTx(txApp, (tx) => syncReservation(tx, id));

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

describe('placeHold / releaseHold (§8.1, §8.2)', () => {
  it('holds 3 of 5 and stays live; the rest reserves it; a release makes it live again', async () => {
    const id = await listingOf('5');
    await place(id, '3');
    let row = await rowOf(id);
    expect(row.status).toBe('live');
    expect(Number(row.heldQuantity)).toBe(3);
    expect(availableOf(row)).toBe('2');
    await assertHeldInvariant(id);

    const second = await place(id, '2');
    row = await rowOf(id);
    expect(row.status).toBe('reserved');
    expect(availableOf(row)).toBe('0');
    await assertHeldInvariant(id);

    await runTx(txApp, (tx) => releaseHold(tx, second));
    row = await rowOf(id);
    expect(row.status).toBe('live');
    expect(availableOf(row)).toBe('2');
    const [hold] = await db.select().from(stockHolds).where(eq(stockHolds.dealId, second));
    expect(hold!.status).toBe('released');
    await assertHeldInvariant(id);

    // A second release is a no-op.
    await runTx(txApp, (tx) => releaseHold(tx, second));
    expect(Number((await rowOf(id)).heldQuantity)).toBe(3);
    await assertHeldInvariant(id);
  });

  it('refuses more than is available with 409 QUANTITY_NOT_AVAILABLE and writes nothing', async () => {
    const id = await listingOf('5');
    await place(id, '4');
    const dealId = await bareDeal(id);
    await expect(runTx(txApp, async (tx) => placeHold(tx, await rowOf(id), dealId, '2'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'QUANTITY_NOT_AVAILABLE',
      details: { available: '1' },
    });
    expect(await db.select().from(stockHolds).where(eq(stockHolds.dealId, dealId))).toEqual([]);
    expect(Number((await rowOf(id)).heldQuantity)).toBe(4);
    await assertHeldInvariant(id);
  });
});

describe('convertHold (§8.1, §27 3)', () => {
  it('takes 2 of 5 off the quantity and the hold', async () => {
    const id = await listingOf('5');
    const dealId = await dealOf(id, '2');
    await runTx(txApp, (tx) => convertHold(tx, dealId));
    const row = await rowOf(id);
    expect(Number(row.quantity)).toBe(3);
    expect(Number(row.heldQuantity)).toBe(0);
    expect(row.status).toBe('live');
    const [hold] = await db.select().from(stockHolds).where(eq(stockHolds.dealId, dealId));
    expect(hold!.status).toBe('converted');
    await assertHeldInvariant(id);
  });

  it('sells the listing out through the system sell_out when the whole quantity converts', async () => {
    const id = await listingOf('5', { minOrderQty: '2' });
    const dealId = await dealOf(id, '5');
    await sync(id);
    expect((await rowOf(id)).status).toBe('reserved');
    await runTx(txApp, (tx) => convertHold(tx, dealId));
    const row = await rowOf(id);
    expect(row.status).toBe('sold');
    expect(Number(row.quantity)).toBe(0);
    expect(row.minOrderQty).toBeNull();
    expect(row.returnStatus).toBeNull();
    const history = await db
      .select()
      .from(listingStatusHistory)
      .where(and(eq(listingStatusHistory.listingId, id), eq(listingStatusHistory.action, 'sell_out')));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: 'reserved', toStatus: 'sold', actor: 'system' });
    await assertHeldInvariant(id);
  });

  it('lowers min_order_qty to what is left', async () => {
    const id = await listingOf('5', { minOrderQty: '4' });
    const dealId = await dealOf(id, '3');
    await runTx(txApp, (tx) => convertHold(tx, dealId));
    const row = await rowOf(id);
    expect(Number(row.quantity)).toBe(2);
    expect(Number(row.minOrderQty)).toBe(2);
    await assertHeldInvariant(id);
  });

  it('sells out from every status (§8.2): sold, return_status sold, or untouched', async () => {
    const cases: Array<[ListingStatus, ListingStatus, ListingStatus | null]> = [
      ['live', 'sold', null],
      ['reserved', 'sold', null],
      ['paused', 'sold', null],
      ['unavailable', 'sold', null],
      ['expired', 'sold', null],
      ['hidden', 'hidden', 'sold'],
      ['pending_review', 'pending_review', 'sold'],
      ['rejected', 'rejected', 'sold'],
      ['removed', 'removed', null],
    ];
    for (const [from, to, returnStatus] of cases) {
      const id = await listingOf('2', { status: from, returnStatus: from === 'hidden' ? 'live' : null });
      const dealId = await dealOf(id, '2');
      await runTx(txApp, (tx) => convertHold(tx, dealId));
      const row = await rowOf(id);
      expect([from, row.status, row.returnStatus]).toEqual([from, to, returnStatus]);
      expect(Number(row.quantity)).toBe(0);
      await assertHeldInvariant(id);
      // Idempotent.
      await sync(id);
      expect((await rowOf(id)).status).toBe(to);
    }
  });
});

describe('stock back while in review (§8.2)', () => {
  it("turns return_status 'sold' back to 'live' once the quantity is above 0 again", async () => {
    const id = await listingOf('3', { status: 'pending_review', returnStatus: 'sold' });
    await sync(id);
    const row = await rowOf(id);
    expect([row.status, row.returnStatus]).toEqual(['pending_review', 'live']);
    await assertHeldInvariant(id);
  });
});

describe('leaving reserved (§8.3, §27 9)', () => {
  /** A reserved listing: all 2 held in one deal. */
  async function reserved(): Promise<string> {
    const id = await listingOf('2');
    await dealOf(id, '2');
    await sync(id);
    expect((await rowOf(id)).status).toBe('reserved');
    return id;
  }

  it('pause and mark unavailable store return_status live', async () => {
    for (const action of ['pause', 'mark_unavailable'] as const) {
      const id = await reserved();
      const res = await app.inject({ method: 'POST', url: `/listings/${id}/actions`, headers: sellerAuth(), payload: { action } });
      expect(res.statusCode).toBe(200);
      const row = await rowOf(id);
      expect(row.status).toBe(action === 'pause' ? 'paused' : 'unavailable');
      expect(row.returnStatus).toBe('live');
      await assertHeldInvariant(id);
    }
  });

  it('hide stores live, and unhide with nothing available lands reserved', async () => {
    const id = await reserved();
    const hide = await app.inject({ method: 'POST', url: `/admin/listings/${id}/hide`, headers: adminAuth(), payload: { reason: 'Checking the photos' } });
    expect(hide.statusCode).toBe(200);
    let row = await rowOf(id);
    expect([row.status, row.returnStatus]).toEqual(['hidden', 'live']);

    const unhide = await app.inject({ method: 'POST', url: `/admin/listings/${id}/unhide`, headers: adminAuth(), payload: {} });
    expect(unhide.statusCode).toBe(200);
    row = await rowOf(id);
    expect(row.status).toBe('reserved');
    expect(row.returnStatus).toBeNull();
    await assertHeldInvariant(id);
  });

  it('back_to_review stores live', async () => {
    const id = await reserved();
    await runTx(txApp, async (tx) => applySystemTransition(tx, await rowOf(id), 'back_to_review', { reviewReasons: ['edit_flagged'] }));
    const row = await rowOf(id);
    expect([row.status, row.returnStatus]).toEqual(['pending_review', 'live']);
    await assertHeldInvariant(id);
  });
});

describe('the stock moves lock only the listing (§8.5, plan review C1)', () => {
  it('refuses lockBusiness: true for sell_out, reserve and unreserve', async () => {
    const id = await listingOf('2');
    for (const action of ['sell_out', 'reserve', 'unreserve'] as const) {
      await expect(
        runTx(txApp, async (tx) => applySystemTransition(tx, await rowOf(id), action, { lockBusiness: true })),
      ).rejects.toThrow(/lockBusiness must not be true/);
    }
    expect((await rowOf(id)).status).toBe('live');
    await assertHeldInvariant(id);
  });
});
