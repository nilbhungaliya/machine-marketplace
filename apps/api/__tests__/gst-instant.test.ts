import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { GstStateView } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { businessVerifications, businesses, gstChecks, gstRepresentativeProofs } from '../src/db/schema.js';
import { signInWithPhone } from '../src/services/user.service.js';
import { resetGstProvider } from '../src/services/verification/gst-provider.js';
import {
  STUB_GSTIN_CANCELLED,
  STUB_GSTIN_NOT_FOUND,
  STUB_GSTIN_UNAVAILABLE,
  resetStubGstins,
  stubSentCodes,
} from '../src/services/verification/gst-stub.js';
import { DECLARATION_TEXT, DECLARATION_VERSION } from '../src/services/verification/gst-instant.service.js';
import {
  createTestBusinessUser,
  deleteTestBusinesses,
  grantTestGst,
  revokeTestGst,
  uniqueTestGstin,
  type TestBusinessUser,
} from './_helpers/test-businesses.js';
import { deleteTestUsers, uniqueTestPhone } from './_helpers/test-users.js';

// GST instant path (F1 + A2 spec §5.2, §5.5): lookup → declare → code → confirm, against the stub (mode `stub`,
// code 123456). Every business here is created per test and deleted in afterAll.

const ENV_KEYS = ['GST_PROVIDER', 'GST_API_KEY', 'NODE_ENV', 'GST_IP_RATE_MAX'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;

describe('GST instant path', () => {
  let app: FastifyInstance;
  const businessIds: string[] = [];
  const userIds: string[] = [];

  async function newBusiness(): Promise<TestBusinessUser> {
    const user = await createTestBusinessUser();
    businessIds.push(user.businessId);
    return user;
  }

  async function call(user: { token: string }, method: 'GET' | 'POST', url: string, body?: object) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${user.token}` }, ...(body ? { payload: body } : {}) });
    return { status: res.statusCode, body: res.json() as { data?: GstStateView; error?: string; code?: string; details?: Record<string, unknown> }, raw: res.body };
  }

  const state = async (user: TestBusinessUser) => (await call(user, 'GET', '/businesses/me/gst')).body.data!;
  const lookup = (user: TestBusinessUser, gstin: string) => call(user, 'POST', '/businesses/me/gst/lookup', { gstin });
  const declare = (user: TestBusinessUser, checkId: string) => call(user, 'POST', '/businesses/me/gst/declare', { checkId });
  const send = (user: TestBusinessUser, proofId: string) => call(user, 'POST', '/businesses/me/gst/otp/send', { proofId });
  const verify = (user: TestBusinessUser, proofId: string, code: string) =>
    call(user, 'POST', '/businesses/me/gst/otp/verify', { proofId, code });

  /** lookup → declare → send; returns the ids. */
  async function toCodeSent(user: TestBusinessUser, gstin: string): Promise<{ checkId: string; proofId: string }> {
    const looked = await lookup(user, gstin);
    expect(looked.status).toBe(200);
    const checkId = looked.body.data!.checkId!;
    const declared = await declare(user, checkId);
    expect(declared.status).toBe(200);
    const proofId = declared.body.data!.proofId!;
    const sent = await send(user, proofId);
    expect(sent.status).toBe(200);
    return { checkId, proofId };
  }

  /** Lets the next send through the 30 s gap. */
  const backdateLastSend = (proofId: string) =>
    db
      .update(gstRepresentativeProofs)
      .set({ lastOtpSentAt: sql`now() - interval '31 seconds'` })
      .where(eq(gstRepresentativeProofs.id, proofId));

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterEach(() => {
    resetStubGstins();
    resetGstProvider();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  afterAll(async () => {
    await deleteTestBusinesses(businessIds);
    await deleteTestUsers(userIds);
    await app.close();
  });

  it('exports the declaration wording and version', () => {
    expect(DECLARATION_VERSION).toBe(1);
    expect(DECLARATION_TEXT).toBe('I am the proprietor, partner, director or authorised signatory of this business');
  });

  it('happy path: lookup → declare → send → verify 123456 ends verified', async () => {
    const user = await newBusiness();
    const gstin = uniqueTestGstin();

    const start = await state(user);
    expect(start).toMatchObject({ mode: 'stub', state: 'none', instantAllowed: true, storageAvailable: false });

    const looked = await lookup(user, ` ${gstin.toLowerCase().slice(0, 7)} ${gstin.slice(7)}`);
    expect(looked.status).toBe(200);
    expect(looked.body.data).toMatchObject({ state: 'found', gstin, details: { status: 'active' } });
    const checkId = looked.body.data!.checkId!;

    const declared = await declare(user, checkId);
    expect(declared.status).toBe(200);
    expect(declared.body.data).toMatchObject({ state: 'found', checkId });
    const proofId = declared.body.data!.proofId!;
    expect(proofId).toBeTruthy();

    const sent = await send(user, proofId);
    expect(sent.status).toBe(200);
    expect(sent.body.data).toMatchObject({ state: 'code_sent', proofId, hint: '98•••••36' });
    expect(Date.parse(sent.body.data!.resendAvailableAt!)).toBeGreaterThan(Date.now());
    expect(stubSentCodes()).toEqual([gstin]);

    const verified = await verify(user, proofId, '123456');
    expect(verified.status).toBe(200);
    expect(verified.body.data).toMatchObject({ state: 'verified', gstin, details: { status: 'active' } });
    expect(verified.body.data!.verifiedAt).toBeTruthy();

    const pan = gstin.slice(2, 12);
    const [b] = await db.select().from(businesses).where(eq(businesses.id, user.businessId));
    expect(b!.gstin).toBe(gstin);
    expect(b!.pan).toBe(pan);
    expect(b!.legalName).toBe(`Sample Engineering ${pan}`);
    expect(b!.constitution).toBe('Proprietorship');
    expect(b!.gstRegisteredOn).toBe('2019-04-01');
    expect(b!.gstAddress).toMatchObject({ city: 'Ahmedabad', pincode: '382445' });
    expect(b!.verificationLevels).toContain('gst');
    expect(b!.verificationStatus).toBe('approved');
    expect(b!.verificationNote).toBeNull();
    expect(b!.verifiedAt).toBeInstanceOf(Date);

    const [v] = await db.select().from(businessVerifications).where(eq(businessVerifications.businessId, user.businessId));
    expect(v).toMatchObject({ level: 'gst', method: 'provider_otp', status: 'active', verifiedByProofId: proofId });
    const [p] = await db.select().from(gstRepresentativeProofs).where(eq(gstRepresentativeProofs.id, proofId));
    expect(p!.status).toBe('passed');
    expect(p!.passedAt).toBeInstanceOf(Date);

    // The contract with the profile service: the name is now GST's trade name, and locked.
    const me = await app.inject({ method: 'GET', url: '/businesses/me', headers: { authorization: `Bearer ${user.token}` } });
    expect(me.json().data).toMatchObject({ nameLocked: true, displayName: `Sample Machine Works ${pan.slice(5, 9)}` });
  });

  it('a user without a business → 404 NO_BUSINESS', async () => {
    const signIn = await signInWithPhone(db, uniqueTestPhone());
    userIds.push(signIn.user.id);
    const res = await call({ token: signIn.token }, 'GET', '/businesses/me/gst');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_BUSINESS');
  });

  it('an invalid GSTIN → 400 GSTIN_INVALID, and nothing is written', async () => {
    const user = await newBusiness();
    const res = await lookup(user, '24AAACC0000C1ZA');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('GSTIN_INVALID');
    expect(await db.select().from(gstChecks).where(eq(gstChecks.businessId, user.businessId))).toHaveLength(0);
  });

  describe('daily lookup limit (5 per business per IST day)', () => {
    it('the 6th lookup in a day → 429 GST_LOOKUP_LIMIT with retryAt at the next IST midnight', async () => {
      const user = await newBusiness();
      const gstin = uniqueTestGstin();
      for (let i = 0; i < 5; i++) expect((await lookup(user, gstin)).status).toBe(200);
      const sixth = await lookup(user, gstin);
      expect(sixth.status).toBe(429);
      expect(sixth.body.code).toBe('GST_LOOKUP_LIMIT');
      expect(sixth.body.error).toBe("You've used today's 5 lookups. Try again tomorrow.");
      const retryAt = new Date(String(sixth.body.details!.retryAt));
      expect(retryAt.getTime()).toBeGreaterThan(Date.now());
      expect(retryAt.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600_000);
      // Midnight in India is 18:30 UTC.
      expect([retryAt.getUTCHours(), retryAt.getUTCMinutes(), retryAt.getUTCSeconds()]).toEqual([18, 30, 0]);
      expect(await db.select().from(gstChecks).where(eq(gstChecks.businessId, user.businessId))).toHaveLength(5);
    });

    it('5 failed lookups (provider unreachable) do not use up the day', async () => {
      const user = await newBusiness();
      for (let i = 0; i < 5; i++) {
        const res = await lookup(user, STUB_GSTIN_UNAVAILABLE);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ state: 'none', providerUnavailable: true });
      }
      expect((await lookup(user, uniqueTestGstin())).status).toBe(200);
    });

    it("officer-source lookups don't count", async () => {
      const user = await newBusiness();
      const gstin = uniqueTestGstin();
      await db.insert(gstChecks).values(
        Array.from({ length: 5 }, () => ({ businessId: user.businessId, gstin, source: 'officer' as const, result: 'found' as const, resolvedAt: sql`now()` })),
      );
      expect((await lookup(user, gstin)).status).toBe(200);
    });

    it("a lookup dated yesterday (India time) doesn't count", async () => {
      const user = await newBusiness();
      const gstin = uniqueTestGstin();
      const yesterdayIst = sql`(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') - interval '1 minute'`;
      await db.insert(gstChecks).values(
        Array.from({ length: 5 }, () => ({
          businessId: user.businessId,
          userId: user.userId,
          gstin,
          source: 'business' as const,
          result: 'found' as const,
          resolvedAt: yesterdayIst,
          createdAt: yesterdayIst,
        })),
      );
      expect((await lookup(user, gstin)).status).toBe(200);
    });
  });

  describe('lookup outcomes', () => {
    it('a cancelled GSTIN → state none with statusRefused, check row status_refused', async () => {
      const user = await newBusiness();
      const res = await lookup(user, STUB_GSTIN_CANCELLED);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ state: 'none', statusRefused: 'cancelled', gstin: STUB_GSTIN_CANCELLED });
      const [row] = await db.select().from(gstChecks).where(eq(gstChecks.businessId, user.businessId));
      expect(row).toMatchObject({ result: 'status_refused', gstStatus: 'cancelled', source: 'business' });
    });

    it('not found → state none with notFound', async () => {
      const user = await newBusiness();
      const res = await lookup(user, STUB_GSTIN_NOT_FOUND);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ state: 'none', notFound: true });
    });

    it('provider unreachable → providerUnavailable, check row failed with no resolved_at', async () => {
      const user = await newBusiness();
      const res = await lookup(user, STUB_GSTIN_UNAVAILABLE);
      expect(res.body.data).toMatchObject({ state: 'none', providerUnavailable: true, gstin: STUB_GSTIN_UNAVAILABLE });
      const [row] = await db.select().from(gstChecks).where(eq(gstChecks.businessId, user.businessId));
      expect(row).toMatchObject({ result: 'failed', resolvedAt: null });
    });

    it('held by another business → held: true and nothing about the other business', async () => {
      const holder = await newBusiness();
      const { gstin } = await grantTestGst(holder.businessId);
      const user = await newBusiness();
      const res = await lookup(user, gstin);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ state: 'none', held: true });
      expect(res.body.data!.details).toBeUndefined();
      expect(res.body.data!.checkId).toBeUndefined();
      expect(res.raw).not.toContain('Sample');
      const [row] = await db.select().from(gstChecks).where(eq(gstChecks.businessId, user.businessId));
      expect(row!.result).toBe('held');
      // A held lookup can't be declared on.
      const declared = await declare(user, row!.id);
      expect(declared.status).toBe(409);
    });
  });

  describe('codes', () => {
    it('a resend within 30 s → 429 GST_OTP_TOO_SOON with retryAt', async () => {
      const user = await newBusiness();
      const { proofId } = await toCodeSent(user, uniqueTestGstin());
      const again = await send(user, proofId);
      expect(again.status).toBe(429);
      expect(again.body.code).toBe('GST_OTP_TOO_SOON');
      expect(Date.parse(String(again.body.details!.retryAt))).toBeGreaterThan(Date.now());
      expect(stubSentCodes()).toHaveLength(1);
    });

    it('the 4th send → 409 GST_OTP_LIMIT', async () => {
      const user = await newBusiness();
      const { proofId } = await toCodeSent(user, uniqueTestGstin());
      for (let i = 0; i < 2; i++) {
        await backdateLastSend(proofId);
        expect((await send(user, proofId)).status).toBe(200);
      }
      await backdateLastSend(proofId);
      const fourth = await send(user, proofId);
      expect(fourth.status).toBe(409);
      expect(fourth.body.code).toBe('GST_OTP_LIMIT');
      expect(stubSentCodes()).toHaveLength(3);
      const [p] = await db.select().from(gstRepresentativeProofs).where(eq(gstRepresentativeProofs.id, proofId));
      expect(p!.otpSends).toBe(3);
    });

    it('5 wrong codes spend the proof; the right code afterwards is refused', async () => {
      const user = await newBusiness();
      const { proofId } = await toCodeSent(user, uniqueTestGstin());
      for (let i = 0; i < 4; i++) {
        const wrong = await verify(user, proofId, '000000');
        expect(wrong.status).toBe(400);
        expect(wrong.body.code).toBe('GST_OTP_INVALID');
      }
      const fifth = await verify(user, proofId, '000000');
      expect(fifth.status).toBe(409);
      expect(fifth.body.code).toBe('GST_OTP_LIMIT');
      const [p] = await db.select().from(gstRepresentativeProofs).where(eq(gstRepresentativeProofs.id, proofId));
      expect(p).toMatchObject({ status: 'spent', otpAttempts: 5 });

      const late = await verify(user, proofId, '123456');
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('GST_PROOF_CLOSED');
      const [b] = await db.select().from(businesses).where(eq(businesses.id, user.businessId));
      expect(b!.gstin).toBeNull();
      expect(b!.verificationLevels).not.toContain('gst');
    });

    it('confirming 31 minutes after the lookup → 409 GST_LOOKUP_EXPIRED, and the state reads expired', async () => {
      const user = await newBusiness();
      const { checkId, proofId } = await toCodeSent(user, uniqueTestGstin());
      await db.update(gstChecks).set({ resolvedAt: sql`now() - interval '31 minutes'` }).where(eq(gstChecks.id, checkId));
      const res = await verify(user, proofId, '123456');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GST_LOOKUP_EXPIRED');
      expect(await state(user)).toMatchObject({ state: 'none', expired: true });
      const [b] = await db.select().from(businesses).where(eq(businesses.id, user.businessId));
      expect(b!.gstin).toBeNull();
    });

    it('a found lookup older than 30 minutes reads expired, and declaring on it → 409 GST_LOOKUP_EXPIRED', async () => {
      const user = await newBusiness();
      const looked = await lookup(user, uniqueTestGstin());
      const checkId = looked.body.data!.checkId!;
      await db.update(gstChecks).set({ resolvedAt: sql`now() - interval '31 minutes'` }).where(eq(gstChecks.id, checkId));
      const read = await state(user);
      expect(read).toMatchObject({ state: 'none', expired: true });
      expect(read.details).toBeUndefined();
      const declared = await declare(user, checkId);
      expect(declared.status).toBe(409);
      expect(declared.body.code).toBe('GST_LOOKUP_EXPIRED');
    });

    it("another business's proof → 404", async () => {
      const owner = await newBusiness();
      const { proofId } = await toCodeSent(owner, uniqueTestGstin());
      const other = await newBusiness();
      expect((await verify(other, proofId, '123456')).status).toBe(404);
      expect((await send(other, proofId)).status).toBe(404);
    });
  });

  describe('who may start (§5.2)', () => {
    it('a revoked business: lookup, declare and otp/send → 409 GST_REVIEW_ONLY, and no code is sent', async () => {
      const user = await newBusiness();
      // An attempt opened before the revocation (a stale app screen).
      const looked = await lookup(user, uniqueTestGstin());
      const checkId = looked.body.data!.checkId!;
      const proofId = (await declare(user, checkId)).body.data!.proofId!;
      await grantTestGst(user.businessId);
      await revokeTestGst(user.businessId, 'Documents did not match');
      resetStubGstins();

      const again = await lookup(user, uniqueTestGstin());
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('GST_REVIEW_ONLY');
      const declared = await declare(user, checkId);
      expect(declared.status).toBe(409);
      expect(declared.body.code).toBe('GST_REVIEW_ONLY');
      const sent = await send(user, proofId);
      expect(sent.status).toBe(409);
      expect(sent.body.code).toBe('GST_REVIEW_ONLY');
      expect(stubSentCodes()).toEqual([]);

      expect(await state(user)).toMatchObject({ state: 'revoked', instantAllowed: false, reason: 'Documents did not match' });
    });

    it('a revoked business with a code already sent cannot confirm it → 409 GST_REVIEW_ONLY', async () => {
      const user = await newBusiness();
      const { proofId } = await toCodeSent(user, uniqueTestGstin());
      await grantTestGst(user.businessId);
      await revokeTestGst(user.businessId);
      const res = await verify(user, proofId, '123456');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GST_REVIEW_ONLY');
    });

    it('a verified business → lookup 409 GST_ALREADY_VERIFIED', async () => {
      const user = await newBusiness();
      await grantTestGst(user.businessId);
      const res = await lookup(user, uniqueTestGstin());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GST_ALREADY_VERIFIED');
      expect(await state(user)).toMatchObject({ state: 'verified', instantAllowed: true });
    });

    it('an open review → lookup and otp/verify 409 GST_REVIEW_OPEN', async () => {
      const user = await newBusiness();
      const gstin = uniqueTestGstin();
      const { proofId } = await toCodeSent(user, gstin);
      await db.insert(gstRepresentativeProofs).values({
        businessId: user.businessId,
        userId: user.userId,
        gstin,
        declarationVersion: DECLARATION_VERSION,
        method: 'documents',
        status: 'waiting',
      });
      const looked = await lookup(user, gstin);
      expect(looked.status).toBe(409);
      expect(looked.body.code).toBe('GST_REVIEW_OPEN');
      const verified = await verify(user, proofId, '123456');
      expect(verified.status).toBe(409);
      expect(verified.body.code).toBe('GST_REVIEW_OPEN');
      expect(await state(user)).toMatchObject({ state: 'under_review' });
    });

    it('GST_PROVIDER=off → mode review, lookup 409 GST_REVIEW_ONLY', async () => {
      process.env.GST_PROVIDER = 'off';
      const user = await newBusiness();
      expect(await state(user)).toMatchObject({ mode: 'review', instantAllowed: false, state: 'none' });
      const res = await lookup(user, uniqueTestGstin());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GST_REVIEW_ONLY');
      expect(await db.select().from(gstChecks).where(eq(gstChecks.businessId, user.businessId))).toHaveLength(0);
    });
  });

  it('route limit: 20 lookups per user per 10 minutes, counted per user', async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    // Invalid GSTINs: refused by the service (400) after the limiter has counted them, so no lookups are spent.
    for (let i = 0; i < 20; i++) expect((await lookup(a, 'NOT-A-GSTIN')).status).toBe(400);
    const limited = await lookup(a, 'NOT-A-GSTIN');
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect((await lookup(b, 'NOT-A-GSTIN')).status).toBe(400);
  });

  it('route limit per IP (GST_IP_RATE_MAX): two users behind one IP together hit 429 on lookup and on otp/send', async () => {
    process.env.GST_IP_RATE_MAX = '5';
    const a = await newBusiness();
    const b = await newBusiness();
    // A fresh address per run, so counts from other tests (all on 127.0.0.1) and earlier runs don't leak in.
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    const otherIp = ip === '203.0.113.251' ? '203.0.113.252' : '203.0.113.251';
    const from = async (user: TestBusinessUser, url: string, body: object, remoteAddress = ip) => {
      // A different X-Forwarded-For on every request: this app trusts no proxy (TRUST_PROXY_HOPS unset), so the header is
      // ignored and every request counts under the connecting address (trust-proxy.test.ts covers hops = 1).
      const forwarded = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
      const res = await app.inject({
        method: 'POST',
        url,
        remoteAddress,
        headers: { authorization: `Bearer ${user.token}`, 'x-forwarded-for': forwarded },
        payload: body,
      });
      return { status: res.statusCode, code: (res.json() as { code?: string }).code };
    };
    const redis = app.redis!;
    const keys = [`rl:gst-ip:lookup:${ip}`, `rl:gst-ip:otp-send:${ip}`, `rl:gst-ip:lookup:${otherIp}`];
    await redis.del(...keys);
    try {
      // 3 + 2 lookups: each user is far below the per-user 20, but the IP's 5 are used.
      for (let i = 0; i < 3; i++) expect((await from(a, '/businesses/me/gst/lookup', { gstin: 'NOT-A-GSTIN' })).status).toBe(400);
      for (let i = 0; i < 2; i++) expect((await from(b, '/businesses/me/gst/lookup', { gstin: 'NOT-A-GSTIN' })).status).toBe(400);
      expect(await from(b, '/businesses/me/gst/lookup', { gstin: 'NOT-A-GSTIN' })).toEqual({ status: 429, code: 'RATE_LIMITED' });
      expect(await from(a, '/businesses/me/gst/lookup', { gstin: 'NOT-A-GSTIN' })).toEqual({ status: 429, code: 'RATE_LIMITED' });
      // Another address is unaffected.
      expect((await from(a, '/businesses/me/gst/lookup', { gstin: 'NOT-A-GSTIN' }, otherIp)).status).toBe(400);

      // otp/send has its own per-IP count (unknown proof → 404 after counting).
      const proofId = '00000000-0000-4000-8000-000000000000';
      for (let i = 0; i < 3; i++) expect((await from(a, '/businesses/me/gst/otp/send', { proofId })).status).toBe(404);
      for (let i = 0; i < 2; i++) expect((await from(b, '/businesses/me/gst/otp/send', { proofId })).status).toBe(404);
      expect(await from(b, '/businesses/me/gst/otp/send', { proofId })).toEqual({ status: 429, code: 'RATE_LIMITED' });
      expect(stubSentCodes()).toEqual([]);
    } finally {
      await redis.del(...keys);
    }
  });

  it('race: two businesses confirm the same GSTIN at once → one 200, one 409 GSTIN_TAKEN', async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    const gstin = uniqueTestGstin();
    const pa = await toCodeSent(a, gstin);
    const pb = await toCodeSent(b, gstin);
    const results = await Promise.allSettled([verify(a, pa.proofId, '123456'), verify(b, pb.proofId, '123456')]);
    const responses = results.map((r) => {
      if (r.status !== 'fulfilled') throw r.reason;
      return r.value;
    });
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(responses.find((r) => r.status === 409)!.body.code).toBe('GSTIN_TAKEN');
    const holders = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.gstin, gstin));
    expect(holders).toHaveLength(1);
    const active = await db
      .select()
      .from(businessVerifications)
      .where(and(inArray(businessVerifications.businessId, [a.businessId, b.businessId]), eq(businessVerifications.status, 'active')));
    expect(active).toHaveLength(1);
    expect(active[0]!.businessId).toBe(holders[0]!.id);
  });
});
