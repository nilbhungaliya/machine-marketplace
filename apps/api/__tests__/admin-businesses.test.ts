import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import type { AdminBusinessDetail, AdminBusinessList, GstStateView } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, businessVerifications, businesses, industrialAreas, users } from '../src/db/schema.js';
import { resetGstProvider } from '../src/services/verification/gst-provider.js';
import { resetStubGstins } from '../src/services/verification/gst-stub.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import {
  createTestBusinessUser,
  deleteTestBusinesses,
  grantTestGst,
  insertTestReview,
  uniqueTestGstin,
  type TestBusinessUser,
} from './_helpers/test-businesses.js';

// Admin businesses API (F1 + A2 spec §5.4, §5.4a, §8.2, §10; Task 11): list, detail, Revoke GST, Release GSTIN.

type Body = { data?: unknown; error?: string; code?: string };

describe('admin businesses', () => {
  let app: FastifyInstance;
  const businessIds: string[] = [];
  const adminIds: string[] = [];
  const areaIds: string[] = [];
  let officer: { id: string; token: string };
  let moderator: { id: string; token: string };
  let support: { id: string; token: string };
  let categoryManager: { id: string; token: string };
  /** A city no other suite uses, so filtered counts are this run's. */
  const city = `Testcity ${Date.now()}`;

  async function newBusiness(opts: { city?: string } = {}): Promise<TestBusinessUser> {
    const user = await createTestBusinessUser();
    businessIds.push(user.businessId);
    if (opts.city) await db.update(businesses).set({ city: opts.city }).where(eq(businesses.id, user.businessId));
    return user;
  }

  async function call(token: string, method: 'GET' | 'POST', url: string, body?: object) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(body ? { payload: body } : {}) });
    return { status: res.statusCode, body: res.json() as Body };
  }

  const list = async (query: string, token = officer.token) => {
    const res = await call(token, 'GET', `/admin/businesses?${query}`);
    expect(res.status).toBe(200);
    return res.body.data as AdminBusinessList;
  };
  const revoke = (id: string, reason: string, token = officer.token) => call(token, 'POST', `/admin/businesses/${id}/gst/revoke`, { reason });
  const release = (id: string, reason: string, token = officer.token) => call(token, 'POST', `/admin/businesses/${id}/gst/release`, { reason });
  const state = async (user: TestBusinessUser) => (await call(user.token, 'GET', '/businesses/me/gst')).body.data as GstStateView;
  const business = async (id: string) => (await db.select().from(businesses).where(eq(businesses.id, id)))[0]!;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    officer = await createTestAdmin('verification_officer');
    moderator = await createTestAdmin('moderator');
    support = await createTestAdmin('support');
    categoryManager = await createTestAdmin('category_manager');
    adminIds.push(officer.id, moderator.id, support.id, categoryManager.id);
  });

  afterEach(() => {
    resetStubGstins();
    resetGstProvider();
  });

  afterAll(async () => {
    await deleteTestBusinesses(businessIds);
    if (areaIds.length > 0) await db.delete(industrialAreas).where(inArray(industrialAreas.id, areaIds));
    await deleteTestAdmins(adminIds);
    await app.close();
  });

  describe('list', () => {
    it('searches by owner phone digits, GSTIN prefix and name', async () => {
      const a = await newBusiness({ city });
      const b = await newBusiness({ city });
      const { gstin } = await grantTestGst(b.businessId);
      const [bRow] = await db.select({ tradeName: businesses.tradeName }).from(businesses).where(eq(businesses.id, b.businessId));

      const byPhone = await list(`search=${encodeURIComponent(a.phone.slice(3, 8) + ' ' + a.phone.slice(8))}`);
      expect(byPhone.rows.map((r) => r.id)).toContain(a.businessId);
      expect(byPhone.rows.find((r) => r.id === a.businessId)).toMatchObject({
        owner: { id: a.userId, phone: a.phone, status: 'active', name: 'Test Owner' },
        verificationStatus: 'not_submitted',
        city,
      });

      const byGstin = await list(`search=${gstin.slice(0, 10).toLowerCase()}`);
      expect(byGstin.rows.map((r) => r.id)).toEqual([b.businessId]);
      // Prefix only: the GSTIN's tail (not part of any name) doesn't match.
      expect((await list(`search=${gstin.slice(11)}`)).rows.map((r) => r.id)).not.toContain(b.businessId);

      const byName = await list(`search=${encodeURIComponent(bRow!.tradeName.toUpperCase())}`);
      expect(byName.rows.map((r) => r.id)).toEqual([b.businessId]);
      const byLegal = await list(`search=${encodeURIComponent(`sample engineering ${gstin.slice(2, 12)}`)}`);
      expect(byLegal.rows.map((r) => r.id)).toEqual([b.businessId]);
    });

    it('searches the city, the linked industrial area name and the typed "Other" area (spec §8.2)', async () => {
      const stamp = Date.now();
      const [area] = await db
        .insert(industrialAreas)
        .values({ name: `Searcharea GIDC ${stamp}`, city: `Areacity ${stamp}`, state: 'Gujarat', sortOrder: 10 })
        .returning();
      areaIds.push(area!.id);
      const linked = await newBusiness();
      await db.update(businesses).set({ industrialAreaId: area!.id }).where(eq(businesses.id, linked.businessId));
      const typed = await newBusiness();
      await db.update(businesses).set({ industrialAreaOther: `Typedplace Estate ${stamp}` }).where(eq(businesses.id, typed.businessId));
      const searchCity = `Searchcity_${stamp}`;
      const inCity = await newBusiness({ city: searchCity });

      const ids = async (search: string) => (await list(`search=${encodeURIComponent(search)}`)).rows.map((r) => r.id);
      expect(await ids(`searcharea gidc ${stamp}`)).toEqual([linked.businessId]);
      expect(await ids(`TYPEDPLACE estate ${stamp}`)).toEqual([typed.businessId]);
      expect(await ids(`searchcity_${stamp}`)).toEqual([inCity.businessId]);
      // LIKE wildcards in the search are literal: "_" matches only an underscore.
      expect(await ids(`Searchcity-${stamp}`)).toEqual([]);
      // The total counts the same matches (the count query joins the areas too).
      expect((await list(`search=${encodeURIComponent(`Searcharea GIDC ${stamp}`)}`)).total).toBe(1);
    });

    it('filters by city, verification and account status; pages with a total', async () => {
      const pagedCity = `${city} paged`;
      const a = await newBusiness({ city: pagedCity });
      const b = await newBusiness({ city: pagedCity });
      const c = await newBusiness({ city: pagedCity });
      await grantTestGst(b.businessId);
      await db.update(users).set({ status: 'suspended' }).where(eq(users.id, c.userId));

      const page1 = await list(`city=${encodeURIComponent(pagedCity)}&pageSize=2&page=1`);
      expect(page1.total).toBe(3);
      expect(page1.rows).toHaveLength(2);
      expect(page1).toMatchObject({ page: 1, pageSize: 2 });
      const page2 = await list(`city=${encodeURIComponent(pagedCity)}&pageSize=2&page=2`);
      expect(page2.total).toBe(3);
      expect(page2.rows).toHaveLength(1);
      expect(new Set([...page1.rows, ...page2.rows].map((r) => r.id))).toEqual(new Set([a.businessId, b.businessId, c.businessId]));

      const approved = await list(`city=${encodeURIComponent(pagedCity)}&verification=approved`);
      expect(approved.rows.map((r) => r.id)).toEqual([b.businessId]);
      expect(approved.total).toBe(1);
      const suspended = await list(`city=${encodeURIComponent(pagedCity)}&status=suspended`);
      expect(suspended.rows.map((r) => r.id)).toEqual([c.businessId]);

      expect((await call(officer.token, 'GET', '/admin/businesses?pageSize=101')).status).toBe(400);
      expect((await call(officer.token, 'GET', '/admin/businesses?verification=bogus')).status).toBe(400);
    });

    it('support and moderator may read; a category manager may not', async () => {
      const a = await newBusiness();
      expect((await call(support.token, 'GET', '/admin/businesses')).status).toBe(200);
      expect((await call(moderator.token, 'GET', `/admin/businesses/${a.businessId}`)).status).toBe(200);
      expect((await call(categoryManager.token, 'GET', '/admin/businesses')).status).toBe(403);
      expect((await call(categoryManager.token, 'GET', `/admin/businesses/${a.businessId}`)).status).toBe(403);
    });
  });

  describe('detail', () => {
    it('profile, users, GST history without document keys, audit entries', async () => {
      const user = await newBusiness({ city });
      const { proofId } = await insertTestReview(user.businessId, { withCheck: true });
      expect((await call(officer.token, 'POST', `/admin/verification/reviews/${proofId}/ask-for-more`, { message: 'Add the ID' })).status).toBe(200);

      const res = await call(support.token, 'GET', `/admin/businesses/${user.businessId}`);
      expect(res.status).toBe(200);
      const d = res.body.data as AdminBusinessDetail;
      expect(d.profile).toMatchObject({ id: user.businessId, verificationStatus: 'pending', location: { city } });
      expect(d.verificationNote).toBe('Add the ID');
      expect(d.users).toEqual([expect.objectContaining({ id: user.userId, phone: user.phone, status: 'active', memberRole: 'owner' })]);
      expect(d.reviewOpen).toBe(true);
      expect(d.gst).toMatchObject({ state: 'needs_more', officerMessage: 'Add the ID' });
      expect(d.history.checks).toHaveLength(1);
      expect(d.history.checks[0]).not.toHaveProperty('details');
      expect(d.history.proofs).toEqual([
        expect.objectContaining({ id: proofId, method: 'documents', status: 'needs_more', documentTypes: ['gst_certificate', 'id_proof'] }),
      ]);
      expect(JSON.stringify(d)).not.toContain('verification/');
      expect(d.audit.map((a) => a.action)).toContain('gst_review.ask_for_more');
      expect(d.audit[0]).toMatchObject({ adminName: 'Test Admin' });
    });

    it('an unknown business → 404', async () => {
      expect((await call(officer.token, 'GET', `/admin/businesses/${randomUUID()}`)).status).toBe(404);
    });
  });

  describe('revoke and release', () => {
    it('revoke → gst leaves the levels, summary rejected, state revoked, the name unlocks; lookup → 409 GST_REVIEW_ONLY', async () => {
      const user = await newBusiness();
      const { gstin } = await grantTestGst(user.businessId);
      const short = await revoke(user.businessId, 'no');
      expect(short.status).toBe(400);
      expect(short.body).toMatchObject({ code: 'VALIDATION_ERROR', error: 'A reason of 3 to 500 characters is required', details: { field: 'reason' } });

      const res = await revoke(user.businessId, 'Certificate was forged');
      expect(res.status).toBe(200);
      const b = await business(user.businessId);
      expect(b.verificationLevels).not.toContain('gst');
      expect(b).toMatchObject({ verificationStatus: 'rejected', verificationNote: 'Certificate was forged', verifiedAt: null, gstin });
      // GST fields kept as the record of what was verified.
      expect(b.legalName).toBe(`Sample Engineering ${gstin.slice(2, 12)}`);
      expect(b.pan).toBe(gstin.slice(2, 12));
      const [v] = await db.select().from(businessVerifications).where(eq(businessVerifications.businessId, user.businessId));
      expect(v).toMatchObject({ status: 'revoked', revocationSource: 'officer', revokedByAdminId: officer.id, revokeReason: 'Certificate was forged' });
      expect(v!.revokedAt).toBeInstanceOf(Date);

      expect(await state(user)).toMatchObject({ state: 'revoked', gstin, instantAllowed: false, reason: 'Certificate was forged' });
      const me = await call(user.token, 'GET', '/businesses/me');
      expect(me.body.data).toMatchObject({ nameLocked: false, displayName: b.tradeName });
      const looked = await call(user.token, 'POST', '/businesses/me/gst/lookup', { gstin: uniqueTestGstin() });
      expect(looked.status).toBe(409);
      expect(looked.body.code).toBe('GST_REVIEW_ONLY');

      const audits = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, user.businessId), eq(auditLog.action, 'gst.revoke')));
      expect(audits).toHaveLength(1);

      const again = await revoke(user.businessId, 'Certificate was forged');
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('GST_NOT_VERIFIED');
    });

    it('release while a review waits → 409 GST_REVIEW_OPEN; while verified → 409 GST_ALREADY_VERIFIED', async () => {
      const verified = await newBusiness();
      await grantTestGst(verified.businessId);
      const res = await release(verified.businessId, 'Owner asked');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GST_ALREADY_VERIFIED');

      expect((await revoke(verified.businessId, 'Documents did not match')).status).toBe(200);
      await insertTestReview(verified.businessId);
      const open = await release(verified.businessId, 'Owner asked');
      expect(open.status).toBe(409);
      expect(open.body.code).toBe('GST_REVIEW_OPEN');
      expect((await business(verified.businessId)).gstin).not.toBeNull();
    });

    it('release after revoke clears the GSTIN fields, reads none (R9), and a second business can verify it via the stub', async () => {
      const first = await newBusiness();
      const { gstin } = await grantTestGst(first.businessId);
      expect((await revoke(first.businessId, 'Documents did not match')).status).toBe(200);
      const res = await release(first.businessId, 'Registration belongs to another firm');
      expect(res.status).toBe(200);

      const b = await business(first.businessId);
      expect(b).toMatchObject({
        gstin: null,
        pan: null,
        legalName: null,
        constitution: null,
        gstRegisteredOn: null,
        gstAddress: null,
        verificationStatus: 'not_submitted',
        verificationNote: 'Registration belongs to another firm',
        verifiedAt: null,
      });
      expect(await state(first)).toMatchObject({ state: 'none', instantAllowed: false });
      expect(await state(first)).not.toHaveProperty('gstin');
      const audits = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, first.businessId), eq(auditLog.action, 'gst.release')));
      expect(audits).toHaveLength(1);
      expect(audits[0]!.before).toMatchObject({ gstin });

      // Nothing left to release.
      expect((await release(first.businessId, 'Again please')).body.code).toBe('GSTIN_NOT_HELD');

      const second = await newBusiness();
      const looked = await call(second.token, 'POST', '/businesses/me/gst/lookup', { gstin });
      expect(looked.body.data).toMatchObject({ state: 'found', gstin });
      const checkId = (looked.body.data as GstStateView).checkId!;
      const proofId = ((await call(second.token, 'POST', '/businesses/me/gst/declare', { checkId })).body.data as GstStateView).proofId!;
      expect((await call(second.token, 'POST', '/businesses/me/gst/otp/send', { proofId })).status).toBe(200);
      const verified = await call(second.token, 'POST', '/businesses/me/gst/otp/verify', { proofId, code: '123456' });
      expect(verified.status).toBe(200);
      expect(verified.body.data).toMatchObject({ state: 'verified', gstin });
    });

    it('a moderator (or support) cannot revoke or release → 403', async () => {
      const user = await newBusiness();
      await grantTestGst(user.businessId);
      expect((await revoke(user.businessId, 'Certificate was forged', moderator.token)).status).toBe(403);
      expect((await release(user.businessId, 'Owner asked', moderator.token)).status).toBe(403);
      expect((await revoke(user.businessId, 'Certificate was forged', support.token)).status).toBe(403);
      expect((await business(user.businessId)).verificationLevels).toContain('gst');
    });

    it('an unknown business → 404', async () => {
      expect((await revoke(randomUUID(), 'Certificate was forged')).status).toBe(404);
    });
  });
});
