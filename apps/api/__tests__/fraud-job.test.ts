import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FraudSignalKind } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/index.js';
import { adminPasswordTokens, chatMessages, contactSightings, fraudScanState, fraudSignals, installSightings } from '../src/db/schema.js';
import { runFraudSignals } from '../src/services/fraud/job.js';
import { runAdminRetention } from '../src/services/fraud/retention.js';
import { FRAUD_EVALUATORS } from '../src/services/fraud/rules.js';
import { advanceScan } from '../src/services/fraud/scan.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { insertTestThread } from './_helpers/test-deals.js';
import { insertTestMessage, insertTestSighting, restoreScanState, saveScanState, testInstallHash } from './_helpers/test-fraud.js';
import { insertTestListing } from './_helpers/test-listings.js';

// Admin close-out A3-3 (§8.2, §9, plan D9): the whole `fraud-signals` job over a scripted chat (the only suite besides
// I-1 that runs it, with `wait: true`, saving and restoring `fraud_scan_state`), failure then retry, the lock, the
// optional key, and the retention job.

const KEY = 'test-signal-hash-key-0123456789abcdef-job';
const PLANTED = '9876543210';
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

let app: FastifyInstance;
let seller: TestBusinessUser;
let savedState: Awaited<ReturnType<typeof saveScanState>>;
const savedKey = process.env.SIGNAL_HASH_KEY;
const businessIds: string[] = [];
const adminIds: string[] = [];

async function business(): Promise<TestBusinessUser> {
  const b = await createTestBusinessUser({ activities: ['buy', 'sell'] });
  businessIds.push(b.businessId);
  return b;
}

async function threadWith(buyer: TestBusinessUser): Promise<string> {
  const { id: listingId } = await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'live', quantity: '10', priceModel: 'negotiable', pricePaise: 10_000,
  });
  return (await insertTestThread({ listingId, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId })).id;
}

const say = (threadId: string, buyer: TestBusinessUser, text: string) =>
  insertTestMessage({ threadId, senderUserId: buyer.userId, senderSide: 'buyer', text, createdAt: minutesAgo(10) });

const signalsOf = (businessId: string, kind: FraudSignalKind) =>
  db.select().from(fraudSignals).where(and(eq(fraudSignals.businessId, businessId), eq(fraudSignals.kind, kind)));

const scanState = async () =>
  (await db.select().from(fraudScanState)).map((r) => ({ rule: r.rule, lastSeq: r.lastSeq, lastAt: r.lastAt?.getTime() ?? null }))
    .sort((a, b) => a.rule.localeCompare(b.rule));

beforeAll(async () => {
  savedState = await saveScanState();
  app = await buildApp({ logger: false });
  seller = await business();
  // Watermarks at "now", so the job reads only this suite's rows.
  await db.delete(fraudScanState);
  const [row] = await db.select({ seq: sql<string | null>`max(${chatMessages.seq})` }).from(chatMessages);
  await advanceScan(db, 'chat_messages', Number(row?.seq ?? 0));
  for (const rule of ['install_sightings', 'new_account_burst', 'reports_against'] as const) await advanceScan(db, rule, minutesAgo(60));
});

beforeEach(() => {
  process.env.SIGNAL_HASH_KEY = KEY;
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (savedKey === undefined) delete process.env.SIGNAL_HASH_KEY;
  else process.env.SIGNAL_HASH_KEY = savedKey;
  await restoreScanState(savedState);
  await deleteTestBusinesses(businessIds);
  await deleteTestAdmins(adminIds);
  await app.close();
});

describe('runFraudSignals', () => {
  it('raises the expected signals once over a scripted chat, and a second run adds nothing', async () => {
    const [b1, b2, d1, d2, d3] = [await business(), await business(), await business(), await business(), await business()];
    const t1 = await threadWith(b1!);
    const t2 = await threadWith(b2!);
    await say(t1, b1!, 'pay to shop@okaxis');
    await say(t1, b1!, `call ${PLANTED}`);
    await say(t1, b1!, 'IFSC HDFC0001234');
    const last = await say(t2, b2!, `my number 98765 43210`);
    const install = crypto.randomUUID();
    for (const d of [d1!, d2!, d3!]) await insertTestSighting({ installId: install, userId: d.userId, lastSeenAt: minutesAgo(5) });

    expect(await runFraudSignals(app, { wait: true })).toBe('ran');
    const counts = async () => ({
      pay: (await signalsOf(b1!.businessId, 'payment_details')).map((s) => s.evidenceCount),
      phone1: (await signalsOf(b1!.businessId, 'repeated_phone')).map((s) => s.evidenceCount),
      phone2: (await signalsOf(b2!.businessId, 'repeated_phone')).map((s) => s.evidenceCount),
      device: await Promise.all([d1!, d2!, d3!].map(async (d) => (await signalsOf(d.businessId, 'shared_device')).map((s) => s.evidenceCount))),
    });
    const first = await counts();
    expect(first).toEqual({ pay: [2], phone1: [2], phone2: [2], device: [[2], [2], [2]] });
    const state = await scanState();
    expect(state.find((r) => r.rule === 'chat_messages')?.lastSeq).toBe(last.seq);

    expect(await runFraudSignals(app, { wait: true })).toBe('ran');
    expect(await counts()).toEqual(first);
  });

  it('an evaluation failing once moves no watermark; the next run reads the same window and raises once', async () => {
    const b = await business();
    const t = await threadWith(b);
    const phoneMsg = await say(t, b, 'pay to shop@ybl or 97000 55566');
    await say(t, b, 'advance bhejo');
    const before = await scanState();
    vi.spyOn(FRAUD_EVALUATORS, 'payment_details').mockRejectedValueOnce(new Error('boom'));
    await runFraudSignals(app, { wait: true });
    expect(await scanState()).toEqual(before);
    expect(await signalsOf(b.businessId, 'payment_details')).toHaveLength(0);

    await runFraudSignals(app, { wait: true });
    const [s] = await signalsOf(b.businessId, 'payment_details');
    expect(s!.evidenceCount).toBe(2);
    expect(await db.select().from(contactSightings).where(eq(contactSightings.messageId, phoneMsg.id))).toHaveLength(1);
    expect((await scanState()).find((r) => r.rule === 'chat_messages')!.lastSeq).toBeGreaterThan(
      before.find((r) => r.rule === 'chat_messages')!.lastSeq!,
    );
  });

  it("skips while another connection holds the job's lock", async () => {
    const client = await pool.connect();
    try {
      await client.query(`SELECT pg_advisory_lock(hashtext('fraud-signals'))`);
      expect(await runFraudSignals(app)).toBe('skipped');
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext('fraud-signals'))`);
      client.release();
    }
  });

  it('without SIGNAL_HASH_KEY raises no repeated_phone and the other kinds still raise', async () => {
    delete process.env.SIGNAL_HASH_KEY;
    const [b4, b5] = [await business(), await business()];
    const t4 = await threadWith(b4!);
    const t5 = await threadWith(b5!);
    const m4 = await say(t4, b4!, 'ring 96000 77788, pay shop@paytm');
    await say(t4, b4!, 'IFSC SBIN0004321');
    await say(t5, b5!, 'ring 96000 77788');
    await runFraudSignals(app, { wait: true });
    expect(await signalsOf(b4!.businessId, 'payment_details')).toHaveLength(1);
    expect(await signalsOf(b4!.businessId, 'repeated_phone')).toHaveLength(0);
    expect(await signalsOf(b5!.businessId, 'repeated_phone')).toHaveLength(0);
    expect(await db.select().from(contactSightings).where(eq(contactSightings.messageId, m4.id))).toHaveLength(0);
  });
});

describe('runAdminRetention', () => {
  it('deletes a 91-day sighting, a signal dismissed 366 days ago and a token used 8 days ago; keeps their younger twins', async () => {
    const b = await business();
    const t = await threadWith(b);
    const m = await say(t, b, 'hello');
    const [oldInstall, youngInstall] = [crypto.randomUUID(), crypto.randomUUID()];
    await insertTestSighting({ installId: oldInstall, userId: b.userId, lastSeenAt: daysAgo(91) });
    await insertTestSighting({ installId: youngInstall, userId: b.userId, lastSeenAt: daysAgo(89) });
    await db.insert(contactSightings).values([
      { phoneHmac: 'a'.repeat(64), businessId: b.businessId, threadId: t, messageId: m.id, seenAt: daysAgo(91) },
      { phoneHmac: 'b'.repeat(64), businessId: b.businessId, threadId: t, messageId: m.id, seenAt: daysAgo(89) },
    ]);
    const closed = (kind: FraudSignalKind, reviewedDaysAgo: number) => ({
      businessId: b.businessId, kind, status: 'dismissed' as const, evidence: [], evidenceCount: 0,
      firstSeenAt: daysAgo(400), lastSeenAt: daysAgo(400), reviewedAt: daysAgo(reviewedDaysAgo), note: 'Old',
    });
    const [oldSignal, youngSignal] = await db
      .insert(fraudSignals)
      .values([closed('reports_against', 366), closed('shared_device', 364)])
      .returning({ id: fraudSignals.id });
    const admin = await createTestAdmin('support');
    adminIds.push(admin.id);
    const [oldToken, youngToken] = await db
      .insert(adminPasswordTokens)
      .values([
        { adminId: admin.id, tokenHash: `old-${crypto.randomUUID()}`, purpose: 'reset', expiresAt: daysAgo(6), usedAt: daysAgo(8) },
        { adminId: admin.id, tokenHash: `young-${crypto.randomUUID()}`, purpose: 'reset', expiresAt: daysAgo(4), usedAt: daysAgo(6) },
      ])
      .returning({ id: adminPasswordTokens.id });

    await runAdminRetention(app);

    const installs = (await db.select().from(installSightings).where(eq(installSightings.userId, b.userId))).map((r) => r.installHash);
    expect(installs).toEqual([testInstallHash(youngInstall)]);
    const contacts = (await db.select().from(contactSightings).where(eq(contactSightings.messageId, m.id))).map((r) => r.phoneHmac);
    expect(contacts).toEqual(['b'.repeat(64)]);
    const signals = (await db.select().from(fraudSignals).where(inArray(fraudSignals.id, [oldSignal!.id, youngSignal!.id]))).map((r) => r.id);
    expect(signals).toEqual([youngSignal!.id]);
    const tokens = (await db.select().from(adminPasswordTokens).where(inArray(adminPasswordTokens.id, [oldToken!.id, youngToken!.id]))).map((r) => r.id);
    expect(tokens).toEqual([youngToken!.id]);
  });
});
