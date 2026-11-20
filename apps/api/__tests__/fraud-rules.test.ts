import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppSettingsValues, FraudSignalKind } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { businesses, chatMessages, contactSightings, fraudSignals, reports } from '../src/db/schema.js';
import { hmacPhone } from '../src/services/fraud/hash.js';
import {
  evaluateNewAccountBurst,
  evaluatePaymentDetails,
  evaluateRepeatedPhone,
  evaluateReportsAgainst,
  evaluateSharedDevice,
} from '../src/services/fraud/rules.js';
import { getSettings } from '../src/services/settings.service.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { addTestMember, insertTestThread } from './_helpers/test-deals.js';
import { insertTestMessage, insertTestSighting } from './_helpers/test-fraud.js';
import { insertTestListing } from './_helpers/test-listings.js';

// Admin close-out A3-3 (§8.1, R8, R9): the five rules with default settings, quiet reading after a close, the 50-item
// cap and privacy. Each case uses its own businesses and calls the rule directly (never the whole job).

const KEY = 'test-signal-hash-key-0123456789abcdef-rules';
const PLANTED = '9876543210';
const PLANTED_DEVANAGARI = '९८७६५४३२१०';

let app: FastifyInstance;
let settings: AppSettingsValues;
let seller: TestBusinessUser;
const businessIds: string[] = [];

async function business(): Promise<TestBusinessUser> {
  const b = await createTestBusinessUser({ activities: ['buy', 'sell'] });
  businessIds.push(b.businessId);
  return b;
}

async function listingOf(s: TestBusinessUser): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: s.businessId, userId: s.userId, kind: 'part', categoryId: null, status: 'live', quantity: '10', priceModel: 'negotiable', pricePaise: 10_000,
  });
  return id;
}

async function threadWith(s: TestBusinessUser, buyer: TestBusinessUser): Promise<string> {
  return (await insertTestThread({ listingId: await listingOf(s), buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId })).id;
}

const signalsOf = (businessId: string, kind: FraudSignalKind) =>
  db.select().from(fraudSignals).where(and(eq(fraudSignals.businessId, businessId), eq(fraudSignals.kind, kind)));

/** A buyer message carrying a phone, with its contact sighting as the scan would store it. */
async function postPhone(threadId: string, buyer: TestBusinessUser, text: string, digits: string): Promise<void> {
  const m = await insertTestMessage({ threadId, senderUserId: buyer.userId, senderSide: 'buyer', text, createdAt: new Date(Date.now() - 600_000) });
  await db.insert(contactSightings).values({
    phoneHmac: hmacPhone(digits, KEY), businessId: buyer.businessId, threadId, messageId: m.id, seenAt: new Date(Date.now() - 600_000),
  });
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  settings = await getSettings(db);
  seller = await business();
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await app.close();
});

describe('shared_device', () => {
  it('3 businesses on one install → a signal on each; 2 → none; 2 members of A + 1 of B → none', async () => {
    const [x1, x2, x3] = [await business(), await business(), await business()];
    const install = crypto.randomUUID();
    for (const x of [x1!, x2!, x3!]) await insertTestSighting({ installId: install, userId: x.userId });
    await evaluateSharedDevice(app, [x1!.businessId], settings);
    for (const x of [x1!, x2!, x3!]) {
      const [s] = await signalsOf(x.businessId, 'shared_device');
      expect(s?.status).toBe('open');
      expect(s!.evidence).toHaveLength(2);
      expect(s!.evidence.every((e) => e.refs.groupId?.length === 8)).toBe(true);
    }

    const [y1, y2] = [await business(), await business()];
    const two = crypto.randomUUID();
    for (const y of [y1!, y2!]) await insertTestSighting({ installId: two, userId: y.userId });
    await evaluateSharedDevice(app, [y1!.businessId, y2!.businessId], settings);
    expect(await signalsOf(y1!.businessId, 'shared_device')).toHaveLength(0);

    const [z1, z2] = [await business(), await business()];
    const member = await addTestMember(z1!.businessId, 'sales');
    const staff = crypto.randomUUID();
    for (const userId of [z1!.userId, member.userId, z2!.userId]) await insertTestSighting({ installId: staff, userId });
    await evaluateSharedDevice(app, [z1!.businessId], settings);
    expect(await signalsOf(z1!.businessId, 'shared_device')).toHaveLength(0);
    expect(await signalsOf(z2!.businessId, 'shared_device')).toHaveLength(0);
  });
});

describe('repeated_phone', () => {
  it('one number from 2 businesses → a signal on each', async () => {
    const [p1, p2] = [await business(), await business()];
    await postPhone(await threadWith(seller, p1!), p1!, `call ${PLANTED}`, PLANTED);
    await postPhone(await threadWith(seller, p2!), p2!, `फोन ${PLANTED_DEVANAGARI}`, PLANTED);
    await evaluateRepeatedPhone(app, [p2!.businessId], settings, KEY);
    for (const p of [p1!, p2!]) expect(await signalsOf(p.businessId, 'repeated_phone')).toHaveLength(1);
    // Off without the key.
    const [p3] = [await business()];
    await postPhone(await threadWith(seller, p3!), p3!, `call ${PLANTED}`, PLANTED);
    await evaluateRepeatedPhone(app, [p3!.businessId], settings, null);
    expect(await signalsOf(p3!.businessId, 'repeated_phone')).toHaveLength(0);
  });

  it('one business in 9 threads → none, in 10 → one', async () => {
    const q = await business();
    const number = '9822233344';
    for (let i = 0; i < 9; i++) await postPhone(await threadWith(seller, q), q, `ring 98222 33344`, number);
    await evaluateRepeatedPhone(app, [q.businessId], settings, KEY);
    expect(await signalsOf(q.businessId, 'repeated_phone')).toHaveLength(0);
    await postPhone(await threadWith(seller, q), q, `ring 98222 33344`, number);
    await evaluateRepeatedPhone(app, [q.businessId], settings, KEY);
    const [s] = await signalsOf(q.businessId, 'repeated_phone');
    expect(s!.evidenceCount).toBe(10);
  });
});

describe('payment_details', () => {
  let r1: TestBusinessUser;
  let r1Thread: string;
  const pay = (text: string, threadId = r1Thread, who = r1) =>
    insertTestMessage({ threadId, senderUserId: who.userId, senderSide: 'buyer', text });

  beforeAll(async () => {
    r1 = await business();
    r1Thread = await threadWith(seller, r1);
  });

  it('2 payment messages → a signal with their match kinds; 1 → none; re-running appends nothing', async () => {
    const r2 = await business();
    const r2Thread = await threadWith(seller, r2);
    await pay('pay to shop@okaxis');
    await pay('IFSC HDFC0001234');
    await pay('is the part available?');
    await pay('pay to other@okaxis', r2Thread, r2);
    await evaluatePaymentDetails(app, [r1.businessId, r2.businessId], settings);
    const [s] = await signalsOf(r1.businessId, 'payment_details');
    expect(s!.evidenceCount).toBe(2);
    const summaries = s!.evidence.map((e) => e.summary).join(' | ');
    expect(summaries).toContain('upi_handle');
    expect(summaries).toContain('bank_details');
    expect(await signalsOf(r2.businessId, 'payment_details')).toHaveLength(0);

    await evaluatePaymentDetails(app, [r1.businessId], settings);
    const [again] = await signalsOf(r1.businessId, 'payment_details');
    expect(again!.evidenceCount).toBe(2);
    expect(again!.evidence).toHaveLength(2);
  });

  it('after a dismiss, one new message raises nothing; a full threshold of new ones opens a new signal', async () => {
    await db
      .update(fraudSignals)
      .set({ status: 'dismissed', reviewedAt: sql`now()`, note: 'Looked fine' })
      .where(and(eq(fraudSignals.businessId, r1.businessId), eq(fraudSignals.kind, 'payment_details')));
    await pay('advance bhejo');
    await evaluatePaymentDetails(app, [r1.businessId], settings);
    expect((await signalsOf(r1.businessId, 'payment_details')).filter((s) => s.status === 'open')).toHaveLength(0);
    await pay('upi://pay?pa=x@ybl');
    await evaluatePaymentDetails(app, [r1.businessId], settings);
    const open = (await signalsOf(r1.businessId, 'payment_details')).filter((s) => s.status === 'open');
    expect(open).toHaveLength(1);
    expect(open[0]!.evidenceCount).toBe(2);
  });

  it('keeps the newest 50 items and counts 55, and a re-run counts nothing twice', async () => {
    const c = await business();
    const threadId = await threadWith(seller, c);
    const now = Date.now();
    await db.insert(chatMessages).values(
      Array.from({ length: 55 }, (_, i) => ({
        threadId, kind: 'text' as const, senderSide: 'buyer' as const, senderUserId: c.userId, text: `pay to shop${i}@okaxis`,
        createdAt: new Date(now - (60 - i) * 60_000),
      })),
    );
    await evaluatePaymentDetails(app, [c.businessId], settings);
    await evaluatePaymentDetails(app, [c.businessId], settings);
    const [s] = await signalsOf(c.businessId, 'payment_details');
    expect(s!.evidence).toHaveLength(50);
    expect(s!.evidenceCount).toBe(55);
  });
});

describe('new_account_burst', () => {
  it('a 3-day-old business contacting 8 businesses in 24 h → a signal; 7 → none; an 8-day-old with 8 → none', async () => {
    const sellers: TestBusinessUser[] = [];
    for (let i = 0; i < 8; i++) sellers.push(await business());
    const [n8, n7, old] = [await business(), await business(), await business()];
    await db.update(businesses).set({ createdAt: sql`now() - interval '3 days'` }).where(inArray(businesses.id, [n8!.businessId, n7!.businessId]));
    await db.update(businesses).set({ createdAt: sql`now() - interval '8 days'` }).where(eq(businesses.id, old!.businessId));
    for (const s of sellers) {
      await threadWith(s, n8!);
      await threadWith(s, old!);
    }
    for (const s of sellers.slice(0, 7)) await threadWith(s, n7!);
    await evaluateNewAccountBurst(app, [n8!.businessId, n7!.businessId, old!.businessId], settings);
    const [s] = await signalsOf(n8!.businessId, 'new_account_burst');
    expect(s!.evidenceCount).toBe(8);
    expect(await signalsOf(n7!.businessId, 'new_account_burst')).toHaveLength(0);
    expect(await signalsOf(old!.businessId, 'new_account_burst')).toHaveLength(0);
  });
});

describe('reports_against', () => {
  it('3 reports from distinct businesses → a signal; 2 + 1 dismissed → none; its own conversation report never counts', async () => {
    const [t1, t2, a, b, c] = [await business(), await business(), await business(), await business(), await business()];
    const report = (targetId: string, reporter: TestBusinessUser, status: 'open' | 'reviewing' | 'actioned' | 'dismissed' = 'open', targetType: 'business' | 'conversation' = 'business') =>
      db.insert(reports).values({
        targetType, targetId, reporterUserId: reporter.userId, reporterBusinessId: reporter.businessId, reason: 'scam_or_advance_payment', status,
        ...(status === 'actioned' || status === 'dismissed' ? { resolvedAt: new Date() } : {}),
      });
    await report(t1!.businessId, a!);
    await report(t1!.businessId, b!, 'reviewing');
    await report(t1!.businessId, c!, 'actioned');
    await report(t2!.businessId, a!);
    await report(t2!.businessId, b!);
    await report(t2!.businessId, c!, 'dismissed');
    // t2 reports its own thread with a: that counts against a, never against t2.
    const thread = await threadWith(a!, t2!);
    await report(thread, t2!, 'open', 'conversation');
    await evaluateReportsAgainst(app, [t1!.businessId, t2!.businessId], settings);
    const [s] = await signalsOf(t1!.businessId, 'reports_against');
    expect(s!.evidenceCount).toBe(3);
    expect(await signalsOf(t2!.businessId, 'reports_against')).toHaveLength(0);
  });
});

describe('privacy', () => {
  it('no fraud_signals text holds the planted number in either form or any message words', async () => {
    const { rows } = await db.execute<{ j: string }>(
      sql`SELECT row_to_json(f)::text AS j FROM fraud_signals f WHERE f.business_id = ANY(${sql.param(businessIds)}::uuid[])`,
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      for (const forbidden of [PLANTED, PLANTED_DEVANAGARI, '98222 33344', '9822233344', 'okaxis', 'HDFC0001234', 'bhejo', 'call ', 'ring ']) {
        expect(r.j).not.toContain(forbidden);
      }
    }
  });
});
