import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { LANGUAGES, type NotificationType } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  deals,
  listings,
  notificationDeliveries,
  notifications,
  partRequestMatches,
  partRequestReplies,
  partRequestTargets,
  partRequestWork,
  partRequests,
  users,
} from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { renderNotification } from '../src/services/notifications/render.js';
import { expirePartRequests } from '../src/services/part-requests/request-jobs.js';
import { enqueuePartRequestWork } from '../src/services/part-requests/work-queue.js';
import { runPartRequestWork } from '../src/services/part-requests/work-job.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestRedisKeys } from './_helpers/test-discovery.js';
import {
  createTestSeller,
  deleteTestSellerExtras,
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
  type TestPartRequestRow,
  type TestPartTree,
} from './_helpers/test-part-requests.js';

// Batch I-1 (F8 plan): the cross-lane cases no single lane could write. The core loop through the API (post → targeting
// with the seller push cap → at-post match → a reply with an existing listing and one with a new prefilled listing
// delivered on approve → a listing going live auto-matched → read → compare → F6 enquiry, offer, accept → fulfil prompt
// → fulfil dropping a pending reply → expiry and renew), then the races of §9.5: close vs a reply send, close vs the job
// delivering a pending reply, two work runs and the expiry job over the same rows. Every notification the suite creates
// renders without the phone number planted in the request's name and note and the reply message.

const SURAT = { lat: 21.17, lng: 72.83 };
/** ~1 km of latitude per 0.009° (plan D18). */
const north = (km: number) => ({ lat: SURAT.lat + km * 0.009, lng: SURAT.lng });
const PLANTED = '9876543210';
const PLANTED_DEVANAGARI = '९८७६५४३२१०';

const fakeIo = { of: () => ({ to: () => ({ emit: () => undefined }) }) };
const noop = () => undefined;
const jobApp = { db, io: fakeIo, log: { warn: noop, error: noop, info: noop } } as unknown as TxApp;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let app: FastifyInstance;
let t: TestPartTree;
let admin: { id: string; token: string };
let restore: () => Promise<void>;
let buyer: TestSeller;
/** GST-verified, near, with a live Pair listing: the best-scored target. */
let a: TestSeller;
/** Near, profile only: replies with new prefilled listings. */
let b: TestSeller;
/** Near, at its daily push cap: targeted without a push; later publishes the matching Left listing. */
let c: TestSeller;
/** Far (150 km): eligible but outside the top N. */
let e: TestSeller;
const sellers: TestSeller[] = [];
const requestIds: string[] = [];

type Res = Awaited<ReturnType<FastifyInstance['inject']>>;
const call = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object): Promise<Res> =>
  app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) });
async function ok(res: Promise<Res>, status = 200): Promise<Record<string, unknown> & { id: string }> {
  const r = await res;
  if (r.statusCode !== status) throw new Error(`expected ${status}, got ${r.statusCode} ${r.body}`);
  return r.json().data;
}

async function newBusiness(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: t.machineCategory.id, point: SURAT, ...opts });
  sellers.push(s);
  await db.execute(sql`INSERT INTO user_devices (user_id, install_id, fcm_token, platform)
    VALUES (${s.userId}, ${`f8i-${randomUUID()}`}, ${`tok-${randomUUID()}`}, 'android')`);
  return s;
}

const listing = (s: TestSeller, extra: Partial<TestListingOptions> = {}) =>
  insertTestListing(db, {
    businessId: s.businessId, userId: s.userId, kind: 'part', categoryId: t.partGroup.id, side: 'left', title: 'Temple roller',
    unitId: t.unitId, conditionId: t.conditionId, quantity: '5', priceModel: 'negotiable', pricePaise: 100_000,
    point: SURAT, searchPoint: SURAT, ...extra,
  }).then((r) => r.id);

/** A request written directly (the races): Left, the part group, any seller within 200 km of Surat. */
async function rawRequest(extra: Partial<Parameters<typeof insertTestPartRequest>[0]> = {}): Promise<TestPartRequestRow> {
  const r = await insertTestPartRequest({
    businessId: buyer.businessId, userId: buyer.userId, categoryId: t.partGroup.id, unitId: t.unitId, side: 'left',
    audience: 'any_seller', reach: 'radius_200', point: SURAT, state: 'Gujarat', ...extra,
  });
  requestIds.push(r.id);
  return r;
}

const postBody = (o: Record<string, unknown> = {}) => ({
  kind: 'part',
  categoryId: t.partGroup.id,
  name: `Temple roller ${PLANTED}`,
  partNumber: 'TR-77L',
  side: 'left',
  quantity: '2',
  unitId: t.unitId,
  reach: 'radius_200',
  audience: 'any_seller',
  validityDays: 15,
  note: `Urgent, call ${PLANTED_DEVANAGARI} or ${PLANTED}`,
  ...o,
});

/** Runs the work job until the queue is empty. */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const { processed, failed } = await runPartRequestWork(jobApp);
    expect(failed).toBe(0);
    if (processed === 0) return;
  }
  throw new Error('work queue never drained');
}

const requestRow = async (id: string) => (await db.select().from(partRequests).where(eq(partRequests.id, id)))[0]!;
const replyRow = async (id: string) => (await db.select().from(partRequestReplies).where(eq(partRequestReplies.id, id)))[0]!;
const versionOf = async (id: string) => (await db.select({ v: listings.version }).from(listings).where(eq(listings.id, id)))[0]!.v;

/** Rows of a type on the request for one business, with their delivery counts. */
async function rowsOf(requestId: string, businessId: string, type: NotificationType) {
  const { rows } = await db.execute<{ id: string; unread_count: number; read_at: string | null; deliveries: number }>(sql`
    SELECT n.id, n.unread_count, n.read_at, (SELECT count(*)::int FROM notification_deliveries d WHERE d.notification_id = n.id) AS deliveries
    FROM notifications n
    WHERE n.part_request_id = ${requestId} AND n.business_id = ${businessId} AND n.type = ${type}`);
  return rows.map((r) => ({ ...r, unread_count: Number(r.unread_count), deliveries: Number(r.deliveries) }));
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  t = await createTestPartTree();
  admin = await createTestAdmin('moderator');
  restore = await setTestSettings({
    part_request_reach_n: 3,
    part_request_seller_push_daily_cap: 10,
    listing_review_first_n: 0,
    offer_open_limit_unverified: 50,
    enquiry_new_per_day_unverified: 100,
  });
  buyer = await newBusiness({ activities: ['buy'] });
  a = await newBusiness({ gst: true, point: north(2) });
  b = await newBusiness({ point: north(5) });
  c = await newBusiness({ point: north(10) });
  e = await newBusiness({ point: north(150) });
  // C has used today's pushes.
  await db.execute(sql`INSERT INTO part_request_push_counts (business_id, day, pushes)
    VALUES (${c.businessId}, (now() AT TIME ZONE 'Asia/Kolkata')::date, 10)`);
});

afterAll(async () => {
  process.env.LISTING_MEDIA_OPTIONAL = 'false';
  await restore?.();
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins([admin?.id].filter(Boolean) as string[]);
  await t?.cleanup();
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  expect(await countF8Rows()).toEqual(expect.objectContaining({ part_requests: 0, part_request_work: 0, notifications_with_request: 0 }));
  expect(Object.values(await countF8Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('the core loop end to end (§20 close-out)', () => {
  let requestId: string;

  it('post → targets (push cap) and an at-post match → replies (existing, new on approve) → auto match → read → compare → deal → fulfil', async () => {
    // A's live Pair listing, there before the request: an at-post match, never a notification.
    const pairListing = await listing(a, { side: 'pair', partNumber: 'TR-77', point: north(2), searchPoint: north(2) });

    // The buyer posts a Left part request.
    const posted = await ok(call(buyer.token, 'POST', '/part-requests', postBody()), 201);
    requestId = posted.id;
    requestIds.push(requestId);
    expect(posted.status).toBe('active');
    await drain();

    // Top N = 3 by score: A (its part-number listing), then B and C by distance; E (150 km) is left out. C is at its
    // push cap: the row without a delivery.
    const targets = await db.select().from(partRequestTargets).where(eq(partRequestTargets.partRequestId, requestId));
    expect(targets.map((x) => x.businessId).sort()).toEqual([a.businessId, b.businessId, c.businessId].sort());
    expect((await rowsOf(requestId, a.businessId, 'part_request_new')).map((r) => r.deliveries)).toEqual([1]);
    expect((await rowsOf(requestId, b.businessId, 'part_request_new')).map((r) => r.deliveries)).toEqual([1]);
    expect((await rowsOf(requestId, c.businessId, 'part_request_new')).map((r) => r.deliveries)).toEqual([0]);
    expect(await rowsOf(requestId, e.businessId, 'part_request_new')).toHaveLength(0);
    const atPost = await db.select().from(partRequestMatches).where(eq(partRequestMatches.partRequestId, requestId));
    expect(atPost.map((m) => [m.listingId, m.source])).toEqual([[pairListing, 'at_post']]);
    expect(await rowsOf(requestId, buyer.businessId, 'part_match')).toHaveLength(0);

    // The seller view never carries the planted number; an untargeted but eligible seller (E) can see it too.
    for (const s of [a, e]) {
      const view = await ok(call(s.token, 'GET', `/part-requests/${requestId}`));
      expect(JSON.stringify(view)).not.toContain(PLANTED);
      expect(JSON.stringify(view)).not.toContain(PLANTED_DEVANAGARI);
    }

    // A replies with its existing Pair listing: delivered, the buyer's grouped reply row.
    const sent = await ok(call(a.token, 'POST', `/part-requests/${requestId}/replies`, { listingIds: [pairListing], message: `Ring ${PLANTED}` }));
    expect((sent.replies as Array<{ status: string }>).map((r) => r.status)).toEqual(['delivered']);
    expect((await rowsOf(requestId, buyer.businessId, 'part_request_reply')).every((r) => r.unread_count === 1)).toBe(true);

    // B lists a matching part from the request: a prefilled draft + a pending reply; it goes to review, the team
    // approves it, the job delivers the reply.
    const draft = await ok(call(b.token, 'POST', '/listings', { kind: 'part', partRequestId: requestId }), 201);
    const [pendingB] = await db.select().from(partRequestReplies).where(eq(partRequestReplies.listingId, draft.id));
    expect(pendingB!.status).toBe('pending');
    await ok(call(b.token, 'PATCH', `/listings/${draft.id}`, {
      quantity: '3', unitId: t.unitId, conditionId: t.conditionId, priceModel: 'negotiable', pricePaise: 95_000, gstMode: 'extra',
      delivery: ['pickup'],
    }));
    // No photos in tests: the dev switch (R31) for the publish and the approval's gate re-check.
    const firstN = await setTestSettings({ listing_review_first_n: 5 });
    process.env.LISTING_MEDIA_OPTIONAL = 'true';
    try {
      const published = await ok(call(b.token, 'POST', `/listings/${draft.id}/publish`));
      expect(published.outcome).toBe('pending_review');
      await drain();
      expect((await replyRow(pendingB!.id)).status).toBe('pending');
      await ok(app.inject({
        method: 'POST', url: `/admin/listings/${draft.id}/approve`, headers: auth(admin.token), payload: { version: await versionOf(draft.id) },
      }));
    } finally {
      process.env.LISTING_MEDIA_OPTIONAL = 'false';
      await firstN();
    }
    await drain();
    expect((await replyRow(pendingB!.id)).status).toBe('delivered');
    expect((await rowsOf(requestId, buyer.businessId, 'part_request_reply')).every((r) => r.unread_count === 2)).toBe(true);

    // C puts a matching Left listing live (resume): the job matches it and tells the buyer (pushed).
    const matchListing = await listing(c, { status: 'paused', partNumber: 'TR-77L', point: north(10), searchPoint: north(10) });
    await ok(call(c.token, 'POST', `/listings/${matchListing}/actions`, { action: 'resume' }));
    await drain();
    const matches = await db.select().from(partRequestMatches).where(eq(partRequestMatches.partRequestId, requestId));
    expect(matches.find((m) => m.listingId === matchListing)).toMatchObject({ source: 'listing_live', tier: 'part_number' });
    const matchRows = await rowsOf(requestId, buyer.businessId, 'part_match');
    expect(matchRows.length).toBeGreaterThan(0);
    expect(matchRows.every((r) => r.unread_count === 1 && r.deliveries === 1)).toBe(true);

    // The buyer opens the request: both grouped rows read.
    await ok(call(buyer.token, 'POST', `/part-requests/${requestId}/read`, {}));
    for (const type of ['part_request_reply', 'part_match'] as const) {
      expect((await rowsOf(requestId, buyer.businessId, type)).every((r) => r.read_at !== null)).toBe(true);
    }

    // Compare: the two replies, then the match (the Pair listing is a reply and a match: one column).
    const compare = (await ok(call(buyer.token, 'GET', `/part-requests/${requestId}/compare`))) as unknown as {
      columns: Array<{ listingId: string; source: string }>;
    };
    expect(compare.columns.map((col) => [col.listingId, col.source]).sort()).toEqual(
      [[pairListing, 'reply'], [draft.id, 'reply'], [matchListing, 'match']].sort(),
    );

    // Through F6: enquiry, offer, the seller accepts → the buyer business is asked to mark the request fulfilled.
    await ok(call(buyer.token, 'POST', `/listings/${matchListing}/enquiry`, { note: 'Is this still available?' }));
    const offered = (await ok(call(buyer.token, 'POST', `/listings/${matchListing}/offers`, {
      kind: 'offer', pricePerUnitPaise: 90_000, quantity: '2',
    }))) as unknown as { offer: { id: string } };
    const accepted = (await ok(call(c.token, 'POST', `/offers/${offered.offer.id}/accept`))) as unknown as { dealId: string };
    const prompts = await rowsOf(requestId, buyer.businessId, 'part_request_fulfil_prompt');
    expect(prompts).toHaveLength(1);
    const [prompt] = await db.select().from(notifications).where(eq(notifications.id, prompts[0]!.id));
    expect(prompt!.dealId).toBe(accepted.dealId);

    // A second prefilled listing from B stays pending; fulfilling drops it.
    const second = await ok(call(b.token, 'POST', '/listings', { kind: 'part', partRequestId: requestId }), 201);
    const [pending2] = await db.select().from(partRequestReplies).where(eq(partRequestReplies.listingId, second.id));
    expect(pending2!.status).toBe('pending');

    const fulfilled = await ok(call(buyer.token, 'POST', `/part-requests/${requestId}/fulfil`, { dealId: accepted.dealId }));
    expect(fulfilled.status).toBe('fulfilled');
    const row = await requestRow(requestId);
    expect([row.status, row.fulfilledDealId]).toEqual(['fulfilled', accepted.dealId]);
    expect(await replyRow(pending2!.id)).toMatchObject({ status: 'dropped', dropReason: 'request_closed' });
    const open = await db
      .select()
      .from(partRequestReplies)
      .where(and(eq(partRequestReplies.partRequestId, requestId), eq(partRequestReplies.status, 'pending')));
    expect(open).toHaveLength(0);
    expect((await db.select().from(deals).where(eq(deals.id, accepted.dealId)))[0]!.status).toBe('agreed');

    // A seller can no longer reply to a fulfilled request.
    const late = await call(a.token, 'POST', `/part-requests/${requestId}/replies`, { listingIds: [await listing(a)] });
    expect([late.statusCode, late.json().code]).toEqual([409, 'PART_REQUEST_NOT_ACTIVE']);
  });

  it('expiry and renew: expired by the job (buyer told once), renewed active, re-targeted without telling anyone twice', async () => {
    const posted = await ok(call(buyer.token, 'POST', '/part-requests', postBody({ name: 'Temple roller bracket' })), 201);
    const id = posted.id;
    requestIds.push(id);
    await drain();
    const before = await db.select().from(partRequestTargets).where(eq(partRequestTargets.partRequestId, id));
    expect(before).toHaveLength(3);

    await db.update(partRequests).set({ expiresAt: sql`now() - interval '1 minute'` as unknown as Date }).where(eq(partRequests.id, id));
    await expirePartRequests(jobApp);
    await expirePartRequests(jobApp);
    expect((await requestRow(id)).status).toBe('expired');
    expect(await rowsOf(id, buyer.businessId, 'part_request_expired')).toHaveLength(1);
    // A seller with no reply on it no longer sees it (§6): 404, never a reply.
    const refused = await call(a.token, 'POST', `/part-requests/${id}/replies`, { listingIds: [await listing(a)] });
    expect([refused.statusCode, refused.json().code]).toEqual([404, 'PART_REQUEST_NOT_FOUND']);

    const badDays = await call(buyer.token, 'POST', `/part-requests/${id}/renew`, { days: 11 });
    expect([badDays.statusCode, badDays.json().code]).toEqual([400, 'VALIDITY_INVALID']);
    const renewed = await ok(call(buyer.token, 'POST', `/part-requests/${id}/renew`, { days: 15 }));
    expect(renewed.status).toBe('active');
    const row = await requestRow(id);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * 24 * 3_600_000);
    expect(await db.select().from(partRequestWork).where(and(eq(partRequestWork.subjectId, id), sql`${partRequestWork.doneAt} IS NULL`))).toHaveLength(1);
    await drain();
    expect((await requestRow(id)).targetPass).toBe(2);
    for (const s of [a, b, c]) expect(await rowsOf(id, s.businessId, 'part_request_new')).toHaveLength(1);
    expect(await db.select().from(partRequestTargets).where(eq(partRequestTargets.partRequestId, id))).toHaveLength(3);
  });
});

/** Delays for the second call of a race: both outcomes show up across the rounds. */
const STAGGER_MS = [0, 0, 5, 15, 30, 60];
const later = <T>(ms: number, fn: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => setTimeout(() => fn().then(resolve, reject), ms));

describe('races (§9.5)', () => {
  it('close racing a reply send: refused (closed requests vanish for sellers without a reply), or delivered before the close', async () => {
    for (let round = 0; round < 6; round++) {
      const r = await rawRequest();
      const l = await listing(a);
      // Even rounds start the close first; odd ones the send, the close 0–60 ms later: both orders are exercised.
      const doSend = () => call(a.token, 'POST', `/part-requests/${r.id}/replies`, { listingIds: [l] });
      const doClose = () => call(buyer.token, 'POST', `/part-requests/${r.id}/close`, { reason: 'found_elsewhere' });
      const [send, closed] =
        round % 2 === 0
          ? (await Promise.all([doClose(), doSend()])).reverse()
          : await Promise.all([doSend(), later(STAGGER_MS[round]!, doClose)]);
      expect(closed.statusCode).toBe(200);
      const row = await requestRow(r.id);
      expect(row.status).toBe('closed');
      const replies = await db.select().from(partRequestReplies).where(eq(partRequestReplies.partRequestId, r.id));
      if (send.statusCode === 200) {
        expect(replies).toHaveLength(1);
        expect(replies[0]!.status).toBe('delivered');
        // The send committed first: the close, serialised behind it on the request lock, already counts the reply.
        expect(closed.json().data.counts.replies).toBe(1);
      } else {
        // 404 when the close committed first (§6: a closed request is gone for a seller with no reply); 409 when the
        // send read it active before the close but locked it after.
        expect([[404, 'PART_REQUEST_NOT_FOUND'], [409, 'PART_REQUEST_NOT_ACTIVE']]).toContainEqual([send.statusCode, send.json().code]);
        expect(replies).toHaveLength(0);
      }
    }
  });

  it('close racing the job delivering a pending reply: dropped request_closed, or delivered before the close', async () => {
    await drain();
    for (let round = 0; round < STAGGER_MS.length; round++) {
      const r = await rawRequest();
      const l = await listing(b, { status: 'pending_review', returnStatus: 'live' });
      const reply = await insertTestReply({ partRequestId: r.id, sellerBusinessId: b.businessId, listingId: l, userId: b.userId, status: 'pending' });
      await ok(app.inject({
        method: 'POST', url: `/admin/listings/${l}/approve`, headers: auth(admin.token), payload: { version: await versionOf(l) },
      }));
      const [run, closed] = await Promise.all([
        runPartRequestWork(jobApp),
        later(STAGGER_MS[round]!, () => call(buyer.token, 'POST', `/part-requests/${r.id}/close`, { reason: 'no_longer_needed' })),
      ]);
      expect(closed.statusCode).toBe(200);
      expect(run.failed).toBe(0);
      await drain();
      expect((await requestRow(r.id)).status).toBe('closed');
      const after = await replyRow(reply.id);
      if (after.status === 'delivered') {
        // The job delivered first: the close, serialised behind it on the request lock, already counts the reply.
        expect(closed.json().data.counts.replies).toBe(1);
      } else {
        expect([after.status, after.dropReason]).toEqual(['dropped', 'request_closed']);
        expect(await rowsOf(r.id, buyer.businessId, 'part_request_reply')).toHaveLength(0);
      }
    }
  });

  /** Three requests due to expire, three live ones, three listings matching all six: 6 target + 3 listing rows queued. */
  async function queueOverlappingWork() {
    await drain();
    const due = [await rawRequest(), await rawRequest(), await rawRequest()];
    const live = [await rawRequest(), await rawRequest(), await rawRequest()];
    await db
      .update(partRequests)
      .set({ expiresAt: sql`now() - interval '1 minute'` as unknown as Date })
      .where(inArray(partRequests.id, due.map((r) => r.id)));
    const changed = [await listing(a), await listing(b), await listing(c, { searchPoint: north(10) })];
    await runTx(jobApp, async (tx) => {
      for (const r of [...due, ...live]) await enqueuePartRequestWork(tx, 'target_request', r.id);
      for (const l of changed) await enqueuePartRequestWork(tx, 'listing_changed', l);
    });
    const queued = (await db.select({ id: partRequestWork.id }).from(partRequestWork).where(sql`${partRequestWork.doneAt} IS NULL`)).map((w) => w.id);
    expect(queued).toHaveLength(9);
    return { due, live, changed, queued };
  }

  /** A worker taking two rows at a time until the queue has nothing due. */
  async function worker(): Promise<{ processed: number; failed: number }> {
    const total = { processed: 0, failed: 0 };
    for (;;) {
      const run = await runPartRequestWork(jobApp, { batch: 2 });
      total.processed += run.processed;
      total.failed += run.failed;
      if (run.processed + run.failed === 0) return total;
    }
  }

  /** Every due request expired exactly once, the live ones still active, each live request matched each listing once. */
  async function expectEachOnce(w: Awaited<ReturnType<typeof queueOverlappingWork>>) {
    // A request the expiry run skipped (locked by the work job, SKIP LOCKED) is taken by the next run.
    await expirePartRequests(jobApp);
    for (const r of w.due) {
      expect((await requestRow(r.id)).status).toBe('expired');
      expect(await rowsOf(r.id, buyer.businessId, 'part_request_expired')).toHaveLength(1);
    }
    for (const r of w.live) expect((await requestRow(r.id)).status).toBe('active');
    const liveMatches = await db.select().from(partRequestMatches).where(inArray(partRequestMatches.partRequestId, w.live.map((r) => r.id)));
    expect(liveMatches.filter((m) => w.changed.includes(m.listingId))).toHaveLength(w.live.length * w.changed.length);
  }

  it('the work job (one run at a time per process, as the runner keeps it) racing the expiry job: no deadlock, each row once', async () => {
    const w = await queueOverlappingWork();
    const [run] = await Promise.all([worker(), expirePartRequests(jobApp)]);
    expect(run).toEqual({ processed: 9, failed: 0 });
    const work = await db.select().from(partRequestWork).where(inArray(partRequestWork.id, w.queued));
    expect(work.every((x) => x.doneAt !== null && x.failedAt === null && x.attempts === 1 && x.lastError === null)).toBe(true);
    await expectEachOnce(w);
  });

  it('two work runs at once (two API instances) and the expiry job: a deadlocked row is released and retried, never lost or doubled', async () => {
    // Known multi-instance item (A2 ruling, PROJECT_STATUS Open items): the at-post backfill (request locked, then match
    // inserts) and a listing_changed row (match inserts, then request locks) can deadlock across instances. Postgres
    // aborts one; the job releases its row with a backoff and the next run does it.
    const w = await queueOverlappingWork();
    const [w1, w2] = await Promise.all([worker(), worker(), expirePartRequests(jobApp)]);
    expect(w1.processed + w2.processed + w1.failed + w2.failed).toBeGreaterThanOrEqual(9);
    const failedRows = await db.select().from(partRequestWork).where(and(inArray(partRequestWork.id, w.queued), sql`${partRequestWork.doneAt} IS NULL`));
    expect(failedRows.every((x) => x.failedAt === null && x.claimedAt === null && x.lastError === 'internal')).toBe(true);
    // The backoff elapsed: the next run finishes them.
    if (failedRows.length) {
      await db.update(partRequestWork).set({ nextAttemptAt: sql`now()` as unknown as Date }).where(inArray(partRequestWork.id, failedRows.map((x) => x.id)));
    }
    expect((await worker()).failed).toBe(0);
    const work = await db.select().from(partRequestWork).where(inArray(partRequestWork.id, w.queued));
    expect(work.every((x) => x.doneAt !== null && x.failedAt === null)).toBe(true);
    await expectEachOnce(w);
  });
});

describe('privacy of every notification the loop created (§17)', () => {
  it('no planted number in any stored params or rendered text, in en, hi and gu', async () => {
    const businessIds = sellers.map((s) => s.businessId);
    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.businessId, businessIds))).map((u) => u.id);
    const rows = await db.select().from(notifications).where(inArray(notifications.userId, userIds));
    expect(rows.length).toBeGreaterThan(10);
    const types = new Set(rows.map((r) => r.type));
    for (const type of ['part_request_new', 'part_request_reply', 'part_match', 'part_request_fulfil_prompt', 'part_request_expired']) {
      expect(types.has(type as NotificationType)).toBe(true);
    }
    for (const n of rows) {
      expect(JSON.stringify(n.params)).not.toContain(PLANTED);
      expect(JSON.stringify(n.params)).not.toContain(PLANTED_DEVANAGARI);
      for (const language of LANGUAGES) {
        const text = renderNotification(n.type, n.params as Record<string, unknown>, language, n.unreadCount);
        expect(`${text.title} ${text.body}`).not.toContain(PLANTED);
        expect(`${text.title} ${text.body}`).not.toContain(PLANTED_DEVANAGARI);
      }
    }
    const deliveries = await db.select().from(notificationDeliveries).where(inArray(notificationDeliveries.notificationId, rows.map((r) => r.id)));
    expect(deliveries.length).toBeGreaterThan(0);
    for (const who of [buyer, a, b, c]) {
      const page = await ok(call(who.token, 'GET', '/notifications'));
      expect(JSON.stringify(page)).not.toContain(PLANTED);
      expect(JSON.stringify(page)).not.toContain(PLANTED_DEVANAGARI);
    }
  });
});
