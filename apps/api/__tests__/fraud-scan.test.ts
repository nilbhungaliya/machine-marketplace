import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { businesses, chatMessages, contactSightings, fraudScanState, fraudSignals, installSightings, users } from '../src/db/schema.js';
import { updateMyProfile } from '../src/services/business/profile.service.js';
import { evaluateSharedDevice } from '../src/services/fraud/rules.js';
import { getSettings } from '../src/services/settings.service.js';
import { signInWithPhone } from '../src/services/user.service.js';
import { advanceScan, scanChatMessages, scanSince } from '../src/services/fraud/scan.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { addTestMember, insertTestThread } from './_helpers/test-deals.js';
import { insertTestMessage, insertTestSighting, restoreScanState, saveScanState, testInstallHash } from './_helpers/test-fraud.js';
import { insertTestListing } from './_helpers/test-listings.js';
import { deleteTestUsers, uniqueTestPhone } from './_helpers/test-users.js';

// Admin close-out A3-2 (§8.2, R9a, R10): install sightings, the chat scan with its seq watermark and 2-minute margin,
// the `last_at` scans, own phones and privacy.

const KEY = 'test-signal-hash-key-0123456789abcdef-scan';
const PLANTED = '9876543210';
const PLANTED_DEVANAGARI = '९८७६५४३२१०';
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

let app: FastifyInstance;
let seller: TestBusinessUser;
let buyer: TestBusinessUser;
let threadId: string;
let savedState: Awaited<ReturnType<typeof saveScanState>>;
const businessIds: string[] = [];
const userIds: string[] = [];

async function newThread(s: TestBusinessUser, b: TestBusinessUser): Promise<string> {
  const { id: listingId } = await insertTestListing(db, {
    businessId: s.businessId, userId: s.userId, kind: 'part', categoryId: null, status: 'live', quantity: '10', priceModel: 'negotiable', pricePaise: 10_000,
  });
  return (await insertTestThread({ listingId, buyerBusinessId: b.businessId, buyerUserId: b.userId })).id;
}

/** Puts the chat watermark at the newest message, so a test scans only its own messages. */
async function chatBaseline(): Promise<void> {
  const [row] = await db.select({ seq: sql<string | null>`max(${chatMessages.seq})` }).from(chatMessages);
  await db.delete(fraudScanState).where(eq(fraudScanState.rule, 'chat_messages'));
  await advanceScan(db, 'chat_messages', Number(row?.seq ?? 0));
}

const sightingsOf = (messageIds: string[]) =>
  db.select().from(contactSightings).where(inArray(contactSightings.messageId, messageIds));

const say = (text: string, createdAt = minutesAgo(10), side: 'buyer' | 'seller' = 'buyer', who?: TestBusinessUser) =>
  insertTestMessage({ threadId, senderUserId: (who ?? (side === 'buyer' ? buyer : seller)).userId, senderSide: side, text, createdAt });

beforeAll(async () => {
  savedState = await saveScanState();
  app = await buildApp({ logger: false });
  seller = await createTestBusinessUser({ activities: ['buy', 'sell'] });
  buyer = await createTestBusinessUser();
  businessIds.push(seller.businessId, buyer.businessId);
  threadId = await newThread(seller, buyer);
});

beforeEach(chatBaseline);

afterAll(async () => {
  await restoreScanState(savedState);
  await deleteTestBusinesses(businessIds);
  await deleteTestUsers(userIds);
  await app.close();
});

describe('scanChatMessages', () => {
  it('two batches of 3 over 5 messages, advancing between them, scan each message once', async () => {
    const msgs = [];
    for (let i = 0; i < 5; i++) msgs.push(await say(`call me on 98000 0000${i}`));
    const first = await scanChatMessages(app, { key: KEY, limit: 3 });
    expect(first.scanned).toBe(3);
    expect(first.mark).toEqual({ lastSeq: msgs[2]!.seq });
    await advanceScan(db, 'chat_messages', first.mark!.lastSeq);
    const second = await scanChatMessages(app, { key: KEY, limit: 3 });
    expect(second.scanned).toBe(2);
    expect(second.mark).toEqual({ lastSeq: msgs[4]!.seq });
    expect(second.touched.has(buyer.businessId)).toBe(true);

    // Re-scanning the same window without advancing inserts no second sighting.
    const again = await scanChatMessages(app, { key: KEY, limit: 3 });
    expect(again.scanned).toBe(2);
    const rows = await sightingsOf(msgs.map((m) => m.id));
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.messageId)).size).toBe(5);
  });

  it('stops at a lower-seq row still inside the margin, never jumping past it; takes both once it ages', async () => {
    const young = await say('young one 98111 22233', new Date());
    const old = await say('old one 98111 22244', minutesAgo(10));
    expect(old.seq).toBeGreaterThan(young.seq);
    const blocked = await scanChatMessages(app, { key: KEY });
    expect(blocked.scanned).toBe(0);
    expect(blocked.mark).toBeNull();
    expect(await sightingsOf([young.id, old.id])).toHaveLength(0);

    await db.update(chatMessages).set({ createdAt: minutesAgo(5) }).where(eq(chatMessages.id, young.id));
    const run = await scanChatMessages(app, { key: KEY });
    expect(run.scanned).toBe(2);
    expect(run.mark).toEqual({ lastSeq: old.seq });
    await advanceScan(db, 'chat_messages', run.mark!.lastSeq);
    expect((await scanChatMessages(app, { key: KEY })).scanned).toBe(0);
    expect(await sightingsOf([young.id, old.id])).toHaveLength(2);
  });

  it('with no watermark row, starts 30 days back: a 31-day-old message is ignored', async () => {
    const other = await createTestBusinessUser();
    businessIds.push(other.businessId);
    const otherThread = await newThread(seller, other);
    await db.delete(fraudScanState).where(eq(fraudScanState.rule, 'chat_messages'));
    const ancient = await insertTestMessage({
      threadId: otherThread, senderUserId: other.userId, senderSide: 'buyer', text: 'pay to oldshop@okaxis', createdAt: minutesAgo(31 * 24 * 60),
    });
    const recent = await say('pay to newshop@okaxis');
    const run = await scanChatMessages(app, { key: KEY });
    expect(run.touched.has(other.businessId)).toBe(false);
    expect(run.touched.has(buyer.businessId)).toBe(true);
    expect(run.mark!.lastSeq).toBeGreaterThanOrEqual(recent.seq);
    expect(ancient.seq).toBeLessThan(recent.seq);
  });

  it("never stores the sender's own phones: its login phone, its contact phone, another member's login phone", async () => {
    const member = await addTestMember(seller.businessId, 'sales');
    const [m] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, member.userId));
    const contact = uniqueTestPhone();
    await db.update(businesses).set({ contactPhone: contact }).where(eq(businesses.id, seller.businessId));
    const digits = (e164: string) => e164.slice(3);
    const own = await say(
      `me ${digits(seller.phone)}, office ${digits(contact)}, my colleague +91 ${digits(m!.phone)}`,
      minutesAgo(10),
      'seller',
    );
    const foreign = await say('try my friend 97000 11122', minutesAgo(10), 'seller');
    await scanChatMessages(app, { key: KEY });
    expect(await sightingsOf([own.id])).toHaveLength(0);
    expect(await sightingsOf([foreign.id])).toHaveLength(1);
  });

  it('stores the planted number only as its HMAC (ASCII and Devanagari read the same, neither form stored)', async () => {
    const a = await say(`call ${PLANTED}`);
    const b = await say(`नंबर ${PLANTED_DEVANAGARI}`);
    await scanChatMessages(app, { key: KEY });
    const rows = await sightingsOf([a.id, b.id]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.phoneHmac).toBe(rows[1]!.phoneHmac);
    const { rows: raw } = await db.execute<{ j: string }>(
      sql`SELECT row_to_json(c)::text AS j FROM contact_sightings c WHERE c.message_id IN (${a.id}::uuid, ${b.id}::uuid)`,
    );
    for (const r of raw) {
      expect(r.j).not.toContain(PLANTED);
      expect(r.j).not.toContain(PLANTED_DEVANAGARI);
    }
  });

  it('without SIGNAL_HASH_KEY writes no sighting and still touches a UPI sender', async () => {
    const m = await say(`pay shop@okaxis or call ${PLANTED}`);
    const run = await scanChatMessages(app, { key: null });
    expect(run.touched.has(buyer.businessId)).toBe(true);
    expect(await sightingsOf([m.id])).toHaveLength(0);
  });
});

describe('scanSince', () => {
  it("marks the newest row's timestamp actually taken, not the window's end", async () => {
    await db.delete(fraudScanState).where(eq(fraudScanState.rule, 'install_sightings'));
    await advanceScan(db, 'install_sightings', minutesAgo(11));
    const at = minutesAgo(10);
    await insertTestSighting({ installId: crypto.randomUUID(), userId: buyer.userId, lastSeenAt: at });
    await insertTestSighting({ installId: crypto.randomUUID(), userId: seller.userId, lastSeenAt: new Date() });
    const scan = await scanSince(db, 'install_sightings');
    const { rows: same } = await db.execute<{ ok: boolean }>(sql`SELECT ${scan.mark}::timestamptz = ${at.toISOString()}::timestamptz AS ok`);
    expect(same[0]!.ok).toBe(true);
    // Advanced to the mark, the row at the mark is not read again.
    await advanceScan(db, 'install_sightings', scan.mark!);
    expect((await scanSince(db, 'install_sightings')).mark).toBeNull();
    expect(scan.rows.map((r) => r.businessId)).toEqual([buyer.businessId]);
  });
});

describe('shared_device for an account onboarded after its sighting', () => {
  it('sign in (sighting) → scan + advance → onboard → the next scan touches the new business and raises at threshold', async () => {
    await db.delete(fraudScanState).where(eq(fraudScanState.rule, 'install_sightings'));
    await advanceScan(db, 'install_sightings', minutesAgo(11));
    const install = crypto.randomUUID();
    const [x1, x2] = [await createTestBusinessUser(), await createTestBusinessUser()];
    businessIds.push(x1!.businessId, x2!.businessId);
    const fresh = await signInWithPhone(db, uniqueTestPhone());
    userIds.push(fresh.user.id);
    for (const userId of [x1!.userId, x2!.userId, fresh.user.id]) await insertTestSighting({ installId: install, userId, lastSeenAt: minutesAgo(10) });

    const before = await scanSince(db, 'install_sightings');
    expect(before.rows.map((r) => r.businessId)).toEqual(expect.arrayContaining([x1!.businessId, x2!.businessId]));
    await advanceScan(db, 'install_sightings', before.mark!);

    const profile = await updateMyProfile(db, fresh.user.id, { name: 'Late Owner', businessName: `Late Works ${Date.now()}`, activities: ['buy'] });
    businessIds.push(profile.id);
    await db.update(businesses).set({ createdAt: minutesAgo(5) }).where(eq(businesses.id, profile.id));
    const after = await scanSince(db, 'install_sightings');
    expect(after.rows.map((r) => r.businessId)).toEqual([profile.id]);

    await evaluateSharedDevice(app, after.rows.map((r) => r.businessId), await getSettings(db));
    for (const id of [x1!.businessId, x2!.businessId, profile.id]) {
      const rows = await db.select().from(fraudSignals).where(and(eq(fraudSignals.businessId, id), eq(fraudSignals.kind, 'shared_device')));
      expect(rows).toHaveLength(1);
    }
  });
});

describe('recordInstallSighting on OTP sign-in', () => {
  it('writes nothing for a non-UUID X-Install-Id and one hashed row for a UUID', async () => {
    const signIn = async (installId: string) => {
      const phone = uniqueTestPhone().slice(3);
      const sent = await app.inject({ method: 'POST', url: '/auth/otp/send', payload: { phone } });
      const res = await app.inject({
        method: 'POST', url: '/auth/otp/verify', headers: { 'x-install-id': installId }, payload: { phone, code: sent.json().data.devCode },
      });
      expect(res.statusCode).toBe(200);
      const userId = res.json().data.user.id as string;
      userIds.push(userId);
      return db.select().from(installSightings).where(eq(installSightings.userId, userId));
    };
    expect(await signIn('not-a-uuid')).toHaveLength(0);
    const id = crypto.randomUUID();
    const rows = await signIn(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.installHash).toBe(testInstallHash(id));
    expect(rows[0]!.installHash).not.toContain(id);
  });
});
