import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { partRequestPushCounts, partRequestTargets, partRequests } from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { processTargetRequest } from '../src/services/part-requests/targeting.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { setTestSettings } from './_helpers/test-offers.js';
import {
  countF8Rows,
  createTestPartTree,
  insertTestFeedback,
  insertTestPartRequest,
  type TestPartRequestRow,
  type TestPartTree,
} from './_helpers/test-part-requests.js';

// Seller targeting (plan A2-2, spec §7.2, §7.3, §7.5): the top N by score, deterministic ties, the reach gate, passes
// that never re-notify, the 2N bound, the seller daily push cap (incl. 0) across concurrent passes, Not relevant.
// Each test builds its own catalogue tree, so only its own sellers are eligible.

const SURAT = { lat: 21.17, lng: 72.83 };
/** ~1 km of latitude per 0.009° (plan D18). */
const north = (km: number) => ({ lat: SURAT.lat + km * 0.009, lng: SURAT.lng });

const noop = () => undefined;
const txApp = { db, log: { error: noop, warn: noop, info: noop } } as unknown as TxApp;

const trees: TestPartTree[] = [];
const sellers: TestSeller[] = [];
const businessIds: string[] = [];
let buyer: TestBusinessUser;
let restore: () => Promise<void>;

async function tree(): Promise<TestPartTree> {
  const t = await createTestPartTree();
  trees.push(t);
  return t;
}

async function seller(t: TestPartTree, opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: t.machineCategory.id, ...opts });
  sellers.push(s);
  businessIds.push(s.businessId);
  await db.execute(sql`INSERT INTO user_devices (user_id, install_id, fcm_token, platform)
    VALUES (${s.userId}, ${`f8t-${randomUUID()}`}, ${`tok-${randomUUID()}`}, 'android')`);
  return s;
}

const request = (t: TestPartTree, extra: Partial<Parameters<typeof insertTestPartRequest>[0]> = {}) =>
  insertTestPartRequest({
    businessId: buyer.businessId, userId: buyer.userId, categoryId: t.machineType.id, unitId: t.unitId, side: 'left',
    audience: 'any_seller', reach: 'radius_200', point: SURAT, state: 'Gujarat', ...extra,
  });

const pass = (id: string) => runTx(txApp, (tx) => processTargetRequest(tx, id));

const targetsOf = async (id: string) =>
  db.select().from(partRequestTargets).where(eq(partRequestTargets.partRequestId, id)).orderBy(asc(partRequestTargets.rank));

/** `part_request_new` rows and their deliveries for the request, per seller business. */
async function told(id: string): Promise<Map<string, { rows: number; deliveries: number }>> {
  const { rows } = await db.execute<{ business_id: string; rows: number; deliveries: number }>(sql`
    SELECT n.business_id, count(DISTINCT n.id)::int AS rows, count(d.id)::int AS deliveries
    FROM notifications n LEFT JOIN notification_deliveries d ON d.notification_id = n.id
    WHERE n.part_request_id = ${id} AND n.type = 'part_request_new'
    GROUP BY n.business_id`);
  return new Map(rows.map((r) => [r.business_id, { rows: Number(r.rows), deliveries: Number(r.deliveries) }]));
}

beforeAll(async () => {
  buyer = await createTestBusinessUser();
  businessIds.push(buyer.businessId);
  restore = await setTestSettings({ part_request_reach_n: 15, part_request_seller_push_daily_cap: 10 });
});

afterAll(async () => {
  await restore?.();
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras(sellers);
  for (const t of trees) await t.cleanup();
  expect(Object.values(await countF8Rows()).every((n) => n === 0)).toBe(true);
});

describe('processTargetRequest: who', () => {
  it('20 eligible sellers, N = 15 → the 15 best by score (nearest profile-only sellers), ranked, each told once', async () => {
    const t = await tree();
    const all: TestSeller[] = [];
    for (let i = 0; i < 20; i++) all.push(await seller(t, { point: north(5 + i * 5) }));
    const r = await request(t);
    await pass(r.id);
    const targets = await targetsOf(r.id);
    expect(targets.map((x) => x.businessId)).toEqual(all.slice(0, 15).map((s) => s.businessId));
    expect(targets.map((x) => x.rank)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(targets.every((x) => x.pass === 1)).toBe(true);
    const scores = targets.map((x) => Number(x.score));
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const notices = await told(r.id);
    expect(notices.size).toBe(15);
    for (const s of all.slice(0, 15)) expect(notices.get(s.businessId)).toEqual({ rows: 1, deliveries: 1 });
    const [row] = await db.select().from(partRequests).where(eq(partRequests.id, r.id));
    expect(row!.targetPass).toBe(1);
    expect(row!.targetedAt).not.toBeNull();
  });

  it('an exact part-number listing outranks a profile-only seller nearer by', async () => {
    const t = await tree();
    const far = await seller(t, { point: north(150) });
    const near = await seller(t, { point: SURAT });
    await insertTestListing(db, {
      businessId: far.businessId, userId: far.userId, kind: 'part', categoryId: t.partGroup.id, side: 'left',
      partNumber: 'TR-500', unitId: t.unitId, quantity: '5', searchPoint: north(150),
    });
    const r = await request(t, { partNumber: 'TR500' });
    const restoreN = await setTestSettings({ part_request_reach_n: 1 });
    try {
      await pass(r.id);
    } finally {
      await restoreN();
    }
    const targets = await targetsOf(r.id);
    expect(targets.map((x) => x.businessId)).toEqual([far.businessId]);
    expect(targets[0]!.bestListingId).not.toBeNull();
    expect(near.businessId).not.toBe(far.businessId);
  });

  it('two sellers equal on every term → the older business first', async () => {
    const t = await tree();
    const older = await seller(t, { point: north(10) });
    const newer = await seller(t, { point: north(10) });
    const r = await request(t);
    await pass(r.id);
    expect((await targetsOf(r.id)).map((x) => x.businessId)).toEqual([older.businessId, newer.businessId]);
  });

  it('reach: radius_50 targets a seller at 40 km, not one at 60 km; state targets the same state only', async () => {
    const t = await tree();
    const in40 = await seller(t, { point: north(40) });
    const out60 = await seller(t, { point: north(60) });
    const r = await request(t, { reach: 'radius_50' });
    await pass(r.id);
    expect((await targetsOf(r.id)).map((x) => x.businessId)).toEqual([in40.businessId]);
    expect(out60).toBeDefined();

    const t2 = await tree();
    const guj = await seller(t2, { point: north(400) });
    const mah = await seller(t2, { point: north(5), state: 'Maharashtra' });
    const r2 = await request(t2, { reach: 'state' });
    await pass(r2.id);
    expect((await targetsOf(r2.id)).map((x) => x.businessId)).toEqual([guj.businessId]);
    expect(mah).toBeDefined();
  });

  it('Not relevant excludes the seller', async () => {
    const t = await tree();
    const a = await seller(t, { point: north(5) });
    const b = await seller(t, { point: north(10) });
    const r = await request(t);
    await insertTestFeedback({ partRequestId: r.id, businessId: a.businessId, userId: a.userId, reason: 'dont_sell_this' });
    await pass(r.id);
    expect((await targetsOf(r.id)).map((x) => x.businessId)).toEqual([b.businessId]);
  });

  it('a request no longer active → nothing', async () => {
    const t = await tree();
    await seller(t, { point: north(5) });
    const r = await request(t, { status: 'closed' });
    await pass(r.id);
    expect(await targetsOf(r.id)).toHaveLength(0);
    expect((await db.select().from(partRequests).where(eq(partRequests.id, r.id)))[0]!.targetPass).toBe(0);
  });
});

describe('processTargetRequest: passes', () => {
  it('running twice (an edit that changes nothing material) adds and tells no one', async () => {
    const t = await tree();
    for (let i = 0; i < 3; i++) await seller(t, { point: north(5 + i) });
    const r = await request(t);
    await pass(r.id);
    await pass(r.id);
    expect(await targetsOf(r.id)).toHaveLength(3);
    const notices = await told(r.id);
    expect([...notices.values()].every((n) => n.rows === 1 && n.deliveries === 1)).toBe(true);
    expect((await db.select().from(partRequests).where(eq(partRequests.id, r.id)))[0]!.targetPass).toBe(2);
  });

  it('a later pass adds exactly the top N newcomers; a seller who dropped out keeps its row and is never told again', async () => {
    const t = await tree();
    const restoreN = await setTestSettings({ part_request_reach_n: 3 });
    try {
      const first = [await seller(t, { point: north(10) }), await seller(t, { point: north(20) }), await seller(t, { point: north(30) })];
      const r = await request(t);
      await pass(r.id);
      const better = [await seller(t, { point: north(1) }), await seller(t, { point: north(2) })];
      await pass(r.id);
      const targets = await targetsOf(r.id);
      expect(targets.map((x) => x.businessId).sort()).toEqual([...first, ...better].map((s) => s.businessId).sort());
      const second = targets.filter((x) => x.pass === 2).map((x) => x.businessId);
      expect(second.sort()).toEqual(better.map((s) => s.businessId).sort());
      await pass(r.id);
      expect(await targetsOf(r.id)).toHaveLength(5);
      const notices = await told(r.id);
      expect(notices.size).toBe(5);
      expect([...notices.values()].every((n) => n.rows === 1)).toBe(true);
    } finally {
      await restoreN();
    }
  });

  it('the stored set never exceeds 2N (N = 3; three passes each bringing 3 new top sellers → 6)', async () => {
    const t = await tree();
    const restoreN = await setTestSettings({ part_request_reach_n: 3 });
    try {
      const r = await request(t);
      for (const km of [90, 60, 30]) {
        for (let i = 0; i < 3; i++) await seller(t, { point: north(km + i) });
        await pass(r.id);
      }
      expect(await targetsOf(r.id)).toHaveLength(6);
      expect((await told(r.id)).size).toBe(6);
    } finally {
      await restoreN();
    }
  });
});

describe('seller push cap (§7.5)', () => {
  it('a seller at 10 pushes today gets the row with no delivery', async () => {
    const t = await tree();
    const s = await seller(t, { point: north(5) });
    await db.execute(sql`INSERT INTO part_request_push_counts (business_id, day, pushes)
      VALUES (${s.businessId}, (now() AT TIME ZONE 'Asia/Kolkata')::date, 10)`);
    const r = await request(t);
    await pass(r.id);
    expect((await told(r.id)).get(s.businessId)).toEqual({ rows: 1, deliveries: 0 });
    expect((await targetsOf(r.id))[0]!.pushed).toBe(false);
  });

  it('cap 0 → no delivery and no push-count row', async () => {
    const t = await tree();
    const s = await seller(t, { point: north(5) });
    const restoreCap = await setTestSettings({ part_request_seller_push_daily_cap: 0 });
    try {
      const r = await request(t);
      await pass(r.id);
      expect((await told(r.id)).get(s.businessId)).toEqual({ rows: 1, deliveries: 0 });
      expect(await db.select().from(partRequestPushCounts).where(eq(partRequestPushCounts.businessId, s.businessId))).toHaveLength(0);
    } finally {
      await restoreCap();
    }
  });

  it('two concurrent passes for two requests targeting the same seller with cap 1 → exactly one delivery', async () => {
    const t = await tree();
    const s = await seller(t, { point: north(5) });
    const restoreCap = await setTestSettings({ part_request_seller_push_daily_cap: 1 });
    try {
      const [r1, r2] = [await request(t), await request(t)];
      await Promise.all([pass(r1.id), pass(r2.id)]);
      const total = [(await told(r1.id)).get(s.businessId)!, (await told(r2.id)).get(s.businessId)!];
      expect(total.map((x) => x.rows)).toEqual([1, 1]);
      expect(total[0]!.deliveries + total[1]!.deliveries).toBe(1);
      const [count] = await db
        .select({ pushes: partRequestPushCounts.pushes })
        .from(partRequestPushCounts)
        .where(and(eq(partRequestPushCounts.businessId, s.businessId)));
      expect(count!.pushes).toBe(1);
    } finally {
      await restoreCap();
    }
  });
});
