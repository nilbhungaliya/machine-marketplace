import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TransactionRollbackError, and, eq, inArray, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { appSettings, businessBlocks, listings, machineModels, partRequestMatches, partRequests } from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { sendDuePushes } from '../src/services/notifications/push-sender.js';
import type { PushProvider } from '../src/services/notifications/push-provider.js';
import { backfillAtPost, insertNewMatches, notifyNewMatch } from '../src/services/part-requests/auto-match.js';
import { lockPartRequestsInOrder } from '../src/services/part-requests/locks.js';
import { processListingChanged } from '../src/services/part-requests/reply-delivery.js';
import { runPartRequestWork } from '../src/services/part-requests/work-job.js';
import { createTestBrand, deleteTestBrands } from './_helpers/test-catalog.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestListing,
  type TestListingOptions,
  type TestSeller,
} from './_helpers/test-listings.js';
import { setTestSettings } from './_helpers/test-offers.js';
import {
  countF8Rows,
  createTestPartTree,
  insertTestPartRequest,
  insertTestReply,
  type TestPartRequestOptions,
  type TestPartTree,
} from './_helpers/test-part-requests.js';

// Auto matches (plan A2-3, spec §7.4, §7.5): the strict rule line by line on real rows, the no-lock insert, the
// lock pass re-checking status, one match and one notification however often a listing re-enters live, the at-post
// backfill, the buyer's push caps against the push job, the 200-candidate bound, and demand.

const SURAT = { lat: 21.17, lng: 72.83 };
const north = (km: number) => ({ lat: SURAT.lat + km * 0.009, lng: SURAT.lng });

const noop = () => undefined;
const txApp = { db, log: { error: noop, warn: noop, info: noop } } as unknown as TxApp;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let app: FastifyInstance;
let buyer: TestBusinessUser;
let seller: TestSeller;
let machineUnit: { id: string };
const brandIds: string[] = [];
const modelIds: string[] = [];
const trees: TestPartTree[] = [];
const sellers: TestSeller[] = [];
const businessIds: string[] = [];

async function tree(): Promise<TestPartTree> {
  const t = await createTestPartTree();
  trees.push(t);
  return t;
}

async function newSeller(t: TestPartTree, opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: t.machineCategory.id, ...opts });
  sellers.push(s);
  businessIds.push(s.businessId);
  return s;
}

const request = (t: TestPartTree, extra: Partial<TestPartRequestOptions> = {}) =>
  insertTestPartRequest({
    businessId: buyer.businessId, userId: buyer.userId, categoryId: t.machineType.id, unitId: t.unitId, side: null,
    name: 'Temple roller', audience: 'any_seller', reach: 'radius_200', point: SURAT, state: 'Gujarat', ...extra,
  });

const listing = (t: TestPartTree, extra: Partial<TestListingOptions> = {}, s: TestSeller = seller) =>
  insertTestListing(db, {
    businessId: s.businessId, userId: s.userId, kind: 'part', categoryId: t.partGroup.id, side: 'left',
    title: 'Temple roller', unitId: t.unitId, conditionId: t.conditionId, quantity: '5', searchPoint: north(5), ...extra,
  }).then((r) => r.id);

const rowOf = async (id: string) => (await db.select().from(listings).where(eq(listings.id, id)))[0]!;

/** The request ids `insertNewMatches` would match for the listing (rolled back). */
async function wouldMatch(listingId: string): Promise<string[]> {
  let out: string[] = [];
  await db
    .transaction(async (tx) => {
      out = (await insertNewMatches(tx, await rowOf(listingId))).map((m) => m.partRequestId);
      tx.rollback();
    })
    .catch((err: unknown) => {
      if (!(err instanceof TransactionRollbackError)) throw err;
    });
  return out.sort();
}
const ids = (...rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

/** The buyer owner's grouped `part_match` row on the request, with its deliveries. */
async function matchRow(requestId: string) {
  const { rows } = await db.execute<{ id: string; unread_count: number; version: number; deliveries: number[] }>(sql`
    SELECT n.id, n.unread_count, n.version,
      COALESCE((SELECT array_agg(d.version ORDER BY d.version) FROM notification_deliveries d WHERE d.notification_id = n.id), '{}') AS deliveries
    FROM notifications n
    WHERE n.part_request_id = ${requestId} AND n.type = 'part_match' AND n.user_id = ${buyer.userId}`);
  return rows;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  buyer = await createTestBusinessUser();
  businessIds.push(buyer.businessId);
  await db.execute(sql`INSERT INTO user_devices (user_id, install_id, fcm_token, platform)
    VALUES (${buyer.userId}, ${`f8m-${randomUUID()}`}, ${`tok-${randomUUID()}`}, 'android')`);
  machineUnit = await createTestMachineUnit();
  const t0 = await tree();
  seller = await newSeller(t0, { gst: true });
});

afterAll(async () => {
  await db.delete(appSettings).where(eq(appSettings.key, 'listing_review_first_n'));
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras(sellers);
  if (modelIds.length) await db.delete(machineModels).where(inArray(machineModels.id, modelIds));
  await deleteTestBrands(brandIds);
  for (const t of trees) await t.cleanup();
  if (machineUnit) await deleteTestUnits([machineUnit.id]);
  expect(Object.values(await countF8Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('matchRuleSql (§7.4)', () => {
  it('sides: Left ← Left, Pair; Right ← Right, Pair; Pair ← Pair; no side ← any', async () => {
    const t = await tree();
    const [rl, rr, rp, rn] = [
      await request(t, { side: 'left' }), await request(t, { side: 'right' }), await request(t, { side: 'pair' }), await request(t),
    ];
    expect(await wouldMatch(await listing(t, { side: 'left' }))).toEqual(ids(rl, rn));
    expect(await wouldMatch(await listing(t, { side: 'right' }))).toEqual(ids(rr, rn));
    expect(await wouldMatch(await listing(t, { side: 'pair' }))).toEqual(ids(rl, rr, rp, rn));
  });

  it('part numbers across separators; a base hit under the side rule; a 2-character number never', async () => {
    const t = await tree();
    const sep = await request(t, { name: 'Zqx', partNumber: 'AB-123/X' });
    expect(await wouldMatch(await listing(t, { title: 'Other thing', partNumber: 'ab 123 x', side: 'not_applicable' }))).toEqual(ids(sep));

    const t2 = await tree();
    const left = await request(t2, { name: 'Zqx', side: 'left', partNumber: 'AB-124-L' });
    expect(await wouldMatch(await listing(t2, { title: 'Other thing', partNumber: 'AB124', side: 'pair' }))).toEqual(ids(left));
    expect(await wouldMatch(await listing(t2, { title: 'Other thing', partNumber: 'AB124R', side: 'right' }))).toEqual([]);

    const t3 = await tree();
    await request(t3, { name: 'Zqx', partNumber: 'AB' });
    expect(await wouldMatch(await listing(t3, { title: 'Other thing', partNumber: 'AB', side: 'not_applicable' }))).toEqual([]);
  });

  it('name ≥ 0.5: matches without fits; with fits only on an overlap', async () => {
    const t = await tree();
    const brand = await createTestBrand();
    brandIds.push(brand.id);
    const models = await db
      .insert(machineModels)
      .values([
        { brandId: brand.id, machineTypeId: t.machineType.id, key: `m1${Date.now()}`, name: 'M1' },
        { brandId: brand.id, machineTypeId: t.machineType.id, key: `m2${Date.now()}`, name: 'M2' },
      ])
      .returning({ id: machineModels.id });
    modelIds.push(...models.map((m) => m.id));
    const [mA, mB] = [models[0]!.id, models[1]!.id];
    const noFits = await request(t);
    const withFits = await request(t, { fits: [{ brandId: brand.id, modelId: mA }] });
    expect(await wouldMatch(await listing(t, { fitments: [{ brandId: brand.id, modelId: mB }] }))).toEqual(ids(noFits));
    expect(await wouldMatch(await listing(t, { fitments: [{ brandId: brand.id, modelId: mA, yearFrom: 2010 }] }))).toEqual(
      ids(noFits, withFits),
    );
    expect(await wouldMatch(await listing(t, { title: 'Gear box housing' }))).toEqual([]);

    // Machines: a fit → listing_machines brand + model overlap (the title doesn't matter).
    const m = await request(t, { kind: 'machine', side: null, name: 'Water jet loom', unitId: machineUnit.id, fits: [{ brandId: brand.id, modelId: mA }] });
    const machine = (modelId: string) =>
      listing(t, {
        kind: 'machine', categoryId: t.machineType.id, side: null, title: 'Used weaving machine', unitId: machineUnit.id,
        quantity: '1', machine: { brandId: brand.id, modelId, year: 2015 },
      });
    expect(await wouldMatch(await machine(mA))).toEqual(ids(m));
    expect(await wouldMatch(await machine(mB))).toEqual([]);
  });

  it('reach: radius_50 at 40 km ✓, 60 km ✗; state: another state ✗; all India ✓ even without a point', async () => {
    const t = await tree();
    const r50 = await request(t, { reach: 'radius_50' });
    expect(await wouldMatch(await listing(t, { searchPoint: north(40) }))).toContain(r50.id);
    expect(await wouldMatch(await listing(t, { searchPoint: north(60) }))).not.toContain(r50.id);

    const t2 = await tree();
    const st = await request(t2, { reach: 'state' });
    const india = await request(t2, { reach: 'all_india' });
    expect(await wouldMatch(await listing(t2, { searchPoint: null, state: 'Kerala' }))).toEqual(ids(india));
    expect(await wouldMatch(await listing(t2, { searchPoint: null, state: 'Gujarat' }))).toEqual(ids(st, india));
  });

  it('condition, availability, audience, blocks and own business', async () => {
    const t = await tree();
    const cond = await request(t, { conditionIds: [randomUUID()] });
    const verified = await request(t, { audience: 'verified_only' });
    const plain = await request(t);
    const unverified = await newSeller(t, { gst: false });

    // Condition outside the list ✗; the GST seller passes verified_only.
    expect(await wouldMatch(await listing(t))).toEqual(ids(verified, plain));
    // An unverified seller fails verified_only.
    expect(await wouldMatch(await listing(t, {}, unverified))).toEqual(ids(plain));
    // Fully held ✗.
    const held = await listing(t, { quantity: '2' });
    await db.update(listings).set({ heldQuantity: '2' }).where(eq(listings.id, held));
    expect(await wouldMatch(held)).toEqual([]);
    // A block either way ✗.
    await db.insert(businessBlocks).values({ blockerBusinessId: buyer.businessId, blockedBusinessId: unverified.businessId, createdByUserId: buyer.userId });
    expect(await wouldMatch(await listing(t, {}, unverified))).toEqual([]);
    // Own business ✗.
    const ownSeller = { ...unverified, businessId: buyer.businessId, userId: buyer.userId };
    expect(await wouldMatch(await listing(t, {}, ownSeller))).toEqual([]);
    expect(cond).toBeDefined();
  });

  it('a pending or delivered reply on the request excludes it', async () => {
    const t = await tree();
    const r = await request(t);
    const l = await listing(t);
    await insertTestReply({ partRequestId: r.id, sellerBusinessId: seller.businessId, listingId: l, userId: seller.userId, status: 'delivered' });
    expect(await wouldMatch(l)).toEqual([]);
  });

  it('a withdrawn reply excludes the listing for good; a dropped one does not', async () => {
    const t = await tree();
    const r = await request(t);
    const withdrawn = await listing(t);
    await insertTestReply({ partRequestId: r.id, sellerBusinessId: seller.businessId, listingId: withdrawn, userId: seller.userId, status: 'withdrawn' });
    expect(await wouldMatch(withdrawn)).toEqual([]);
    const dropped = await listing(t);
    await insertTestReply({ partRequestId: r.id, sellerBusinessId: seller.businessId, listingId: dropped, userId: seller.userId, status: 'dropped' });
    expect(await wouldMatch(dropped)).toEqual([r.id]);
  });

  it('201 candidate requests → the 200 newest are checked, the oldest left out', async () => {
    const t = await tree();
    const all: string[] = [];
    for (let i = 0; i < 201; i++) all.push((await request(t)).id);
    // all[0] is the oldest (inserted first, and moved two days back).
    await db.update(partRequests).set({ createdAt: sql`now() - interval '2 days'` as unknown as Date }).where(eq(partRequests.id, all[0]!));
    const got = await wouldMatch(await listing(t));
    expect(got).toHaveLength(200);
    expect(got).not.toContain(all[0]);
  });
});

describe('insertNewMatches and the lock pass', () => {
  it('completes while another transaction holds the request FOR NO KEY UPDATE', async () => {
    const t = await tree();
    const r = await request(t);
    const l = await listing(t);
    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((res) => (locked = res));
    const held = new Promise<void>((res) => (release = res));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM part_requests WHERE id = ${r.id} FOR NO KEY UPDATE`);
      locked();
      await held;
    });
    await isLocked;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
        const got = await insertNewMatches(tx, await rowOf(l));
        expect(got.map((m) => m.partRequestId)).toEqual([r.id]);
      });
    } finally {
      release();
      await holder;
    }
    expect(await db.select().from(partRequestMatches).where(eq(partRequestMatches.partRequestId, r.id))).toHaveLength(1);
  });

  it('a request closed after the insert and before the lock pass keeps the match row, with no notification', async () => {
    const t = await tree();
    const r = await request(t);
    const l = await rowOf(await listing(t));
    await runTx(txApp, async (tx) => {
      const got = await insertNewMatches(tx, l);
      // Another connection closes the request (the match's FK holds only KEY SHARE: no wait).
      await db
        .update(partRequests)
        .set({ status: 'closed', closeReason: 'other', closedAt: new Date() })
        .where(eq(partRequests.id, r.id));
      const locked = new Map((await lockPartRequestsInOrder(tx, got.map((m) => m.partRequestId))).map((x) => [x.id, x]));
      for (const m of got) await notifyNewMatch(tx, locked.get(m.partRequestId)!, l, m);
    });
    expect(await db.select().from(partRequestMatches).where(eq(partRequestMatches.partRequestId, r.id))).toHaveLength(1);
    expect(await matchRow(r.id)).toHaveLength(0);
  });

  it('publish → pause → resume → renew → a title PATCH: one match row and one notification event in all', async () => {
    const t = await tree();
    const s = await newSeller(t, { gst: true });
    await db.insert(appSettings).values({ key: 'listing_review_first_n', value: 0 }).onConflictDoUpdate({ target: appSettings.key, set: { value: 0 } });
    // The listing's search point comes from its pincode (no test centroid), so the request reaches by state.
    const r = await request(t, { reach: 'state', side: 'left' });
    const id = await listing(t, { status: 'draft', publishedAt: null, refreshedAt: null, firstLiveAt: null, quantity: '10' }, s);
    const work = () => runPartRequestWork(txApp);
    const act = (action: string) => app.inject({ method: 'POST', url: `/listings/${id}/actions`, headers: auth(s.token), payload: { action } });

    expect((await app.inject({ method: 'POST', url: `/listings/${id}/publish`, headers: auth(s.token) })).json().data.outcome).toBe('live');
    await work();
    for (const action of ['pause', 'resume', 'renew']) {
      expect((await act(action)).statusCode).toBe(200);
      await work();
    }
    expect((await app.inject({ method: 'PATCH', url: `/listings/${id}`, headers: auth(s.token), payload: { title: 'Temple roller left hand' } })).statusCode).toBe(200);
    await work();

    expect(await db.select().from(partRequestMatches).where(eq(partRequestMatches.partRequestId, r.id))).toHaveLength(1);
    const rows = await matchRow(r.id);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.unread_count)).toBe(1);
  });

  it('the at-post backfill stores at_post matches and tells no one', async () => {
    const t = await tree();
    const [a, b] = [await listing(t), await listing(t, { searchPoint: north(20) })];
    const r = await request(t);
    const n = await runTx(txApp, async (tx) => backfillAtPost(tx, (await db.select().from(partRequests).where(eq(partRequests.id, r.id)))[0]!));
    expect(n).toBe(2);
    const rows = await db.select().from(partRequestMatches).where(eq(partRequestMatches.partRequestId, r.id));
    expect(rows.map((x) => x.listingId).sort()).toEqual([a, b].sort());
    expect(rows.every((x) => x.source === 'at_post' && x.distanceKm !== null)).toBe(true);
    expect(await matchRow(r.id)).toHaveLength(0);
  });
});

describe('buyer push caps (§7.5)', () => {
  const sent: string[] = [];
  const provider: PushProvider = { name: 'dev', send: async (m) => (sent.push(m.data.deliveryKey), { kind: 'sent', messageId: 'x' }) };

  it('daily cap 2: three matches push twice; the third bumps count without a version, and the queued v2 push is sent', async () => {
    const t = await tree();
    const restore = await setTestSettings({ part_request_match_push_daily_cap: 2, part_request_match_push_total_cap: 20 });
    try {
      const r = await request(t);
      for (let i = 0; i < 3; i++) {
        const l = await listing(t);
        await runTx(txApp, (tx) => processListingChanged(tx, l));
      }
      const [row] = await matchRow(r.id);
      expect(Number(row!.unread_count)).toBe(3);
      expect(Number(row!.version)).toBe(2);
      expect(row!.deliveries.map(Number)).toEqual([1, 2]);
      const pushedRows = await db
        .select()
        .from(partRequestMatches)
        .where(and(eq(partRequestMatches.partRequestId, r.id), eq(partRequestMatches.pushed, true)));
      expect(pushedRows).toHaveLength(2);

      sent.length = 0;
      await sendDuePushes(txApp, { provider });
      expect(sent).toContain(`${row!.id}:2`);
      expect(sent).not.toContain(`${row!.id}:1`);
      const { rows: states } = await db.execute<{ version: number; state: string }>(
        sql`SELECT version, state FROM notification_deliveries WHERE notification_id = ${row!.id} ORDER BY version`,
      );
      expect(states.map((s) => s.state)).toEqual(['skipped', 'sent']);
    } finally {
      await restore();
    }
  });

  it('the total cap reached → no push on a new day', async () => {
    const t = await tree();
    const restore = await setTestSettings({ part_request_match_push_daily_cap: 3, part_request_match_push_total_cap: 5 });
    try {
      const r = await request(t);
      await db.execute(sql`UPDATE part_requests SET match_push_total = 5, match_push_day_count = 3,
        match_push_day = (now() AT TIME ZONE 'Asia/Kolkata')::date - 1 WHERE id = ${r.id}`);
      const l = await listing(t);
      await runTx(txApp, (tx) => processListingChanged(tx, l));
      const [row] = await matchRow(r.id);
      expect(Number(row!.unread_count)).toBe(1);
      expect(row!.deliveries).toHaveLength(0);
      const [m] = await db.select().from(partRequestMatches).where(eq(partRequestMatches.partRequestId, r.id));
      expect(m!.pushed).toBe(false);
    } finally {
      await restore();
    }
  });
});

describe('demand (GET /listings/:id/part-request-demand)', () => {
  it('counts what a draft and a listing in review would match; 404 for anyone but the owner', async () => {
    const t = await tree();
    const s = await newSeller(t);
    const r = await request(t);
    const draft = await listing(t, { status: 'draft', quantity: undefined, publishedAt: null }, s);
    const review = await listing(t, { status: 'pending_review', returnStatus: 'live' }, s);
    for (const id of [draft, review]) {
      const res = await app.inject({ method: 'GET', url: `/listings/${id}/part-request-demand`, headers: auth(s.token) });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ count: 1, partRequestIds: [r.id] });
    }
    const other = await app.inject({ method: 'GET', url: `/listings/${draft}/part-request-demand`, headers: auth(buyer.token) });
    expect(other.statusCode).toBe(404);
    expect(other.json().code).toBe('LISTING_NOT_FOUND');
  });
});
