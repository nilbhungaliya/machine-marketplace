import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import type { AdminGstReviewDetail, AdminGstReviewRow, GstDocumentType, GstStateView } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, businessVerifications, businesses, gstChecks, gstRepresentativeProofs } from '../src/db/schema.js';
import { STORAGE_ENV } from '../src/lib/storage.js';
import { presignDocumentRead } from '../src/services/verification/gst-documents.service.js';
import { DECLARATION_VERSION } from '../src/services/verification/gst-instant.service.js';
import { addReviewFiles, submitReview, type StageFn } from '../src/services/verification/gst-review.service.js';
import { resetGstProvider } from '../src/services/verification/gst-provider.js';
import { STUB_GSTIN_CANCELLED, resetStubGstins, setStubGstin } from '../src/services/verification/gst-stub.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import {
  createTestBusinessUser,
  deleteTestBusinesses,
  grantTestGst,
  insertTestReview,
  revokeTestGst,
  testEntered,
  uniqueTestGstin,
  type TestBusinessUser,
} from './_helpers/test-businesses.js';

// GST path A, the officer review (F1 + A2 spec §5.3, §5.4a, §6; Task 10). No R2 keys exist here: officer-side tests use
// `insertTestReview` (fake `verification/...` keys), and the submit path's staging step is replaced by a fake `stage`.

const ENV_KEYS = ['GST_PROVIDER', 'GST_API_KEY', 'NODE_ENV', ...STORAGE_ENV] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<string, string | undefined>;

function clearStorageEnv(): void {
  for (const key of STORAGE_ENV) delete process.env[key];
}
function fakeStorageEnv(): void {
  process.env.AWS_S3_ENDPOINT = 'https://example-account.r2.cloudflarestorage.com';
  process.env.AWS_REGION = 'auto';
  process.env.AWS_ACCESS_KEY_ID = 'test-key-id';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
  process.env.AWS_S3_PRIVATE_BUCKET = 'test-private';
}

type Body = { data?: unknown; error?: string; code?: string; details?: Record<string, unknown> };

describe('GST review (path A)', () => {
  let app: FastifyInstance;
  const businessIds: string[] = [];
  const adminIds: string[] = [];
  let officer: { id: string; token: string };
  let support: { id: string; token: string };
  let superAdmin: { id: string; token: string };

  async function newBusiness(): Promise<TestBusinessUser> {
    const user = await createTestBusinessUser();
    businessIds.push(user.businessId);
    return user;
  }

  async function call(token: string, method: 'GET' | 'POST', url: string, body?: object) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(body ? { payload: body } : {}) });
    return { status: res.statusCode, body: res.json() as Body };
  }

  const state = async (user: TestBusinessUser) => (await call(user.token, 'GET', '/businesses/me/gst')).body.data as GstStateView;
  const business = async (id: string) => (await db.select().from(businesses).where(eq(businesses.id, id)))[0]!;
  const proof = async (id: string) => (await db.select().from(gstRepresentativeProofs).where(eq(gstRepresentativeProofs.id, id)))[0]!;
  const approve = (id: string, edits?: object, token = officer.token) =>
    call(token, 'POST', `/admin/verification/reviews/${id}/approve`, edits ?? {});
  const reject = (id: string, reason: string) => call(officer.token, 'POST', `/admin/verification/reviews/${id}/reject`, { reason });
  const askForMore = (id: string, message: string) =>
    call(officer.token, 'POST', `/admin/verification/reviews/${id}/ask-for-more`, { message });
  const auditRows = (entityId: string, action: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)));

  /** Incoming keys shaped as the presign hands them out (the files themselves don't exist). */
  function incomingFiles(user: TestBusinessUser, uploadId: string, types: GstDocumentType[]) {
    return types.map((type) => ({ key: `incoming-verification/${user.businessId}/${uploadId}/${randomUUID()}.pdf`, type }));
  }

  /** A stand-in for `stageDocuments`: the copies it would have made, without R2. */
  const fakeStage: StageFn = async (input) => ({
    copied: input.files.map((f) => ({ key: `verification/${input.businessId}/${input.proofId}/${randomUUID()}.pdf`, type: f.type })),
    incoming: input.files.map((f) => f.key),
  });

  function submitBody(user: TestBusinessUser, overrides: Record<string, unknown> = {}) {
    const uploadId = randomUUID();
    return {
      gstin: uniqueTestGstin(),
      entered: testEntered(),
      declarationVersion: DECLARATION_VERSION,
      uploadId,
      files: incomingFiles(user, uploadId, ['gst_certificate', 'id_proof']),
      ...overrides,
    };
  }

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    officer = await createTestAdmin('verification_officer');
    support = await createTestAdmin('support');
    superAdmin = await createTestAdmin('super_admin');
    adminIds.push(officer.id, support.id, superAdmin.id);
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
    await deleteTestAdmins(adminIds);
    await app.close();
  });

  describe('submit (business)', () => {
    const submit = (user: TestBusinessUser, body: object) => call(user.token, 'POST', '/businesses/me/gst/review', body);

    it('a verified business → 409 GST_ALREADY_VERIFIED', async () => {
      const user = await newBusiness();
      await grantTestGst(user.businessId);
      const res = await submit(user, submitBody(user));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GST_ALREADY_VERIFIED');
    });

    it('an open review → 409 GST_REVIEW_OPEN', async () => {
      const user = await newBusiness();
      await insertTestReview(user.businessId);
      const res = await submit(user, submitBody(user));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GST_REVIEW_OPEN');
    });

    it('a GSTIN another business holds → 409 GSTIN_TAKEN with the "already linked" message', async () => {
      const holder = await newBusiness();
      const { gstin } = await grantTestGst(holder.businessId);
      const user = await newBusiness();
      const res = await submit(user, submitBody(user, { gstin }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GSTIN_TAKEN');
      expect(res.body.error).toBe("This GSTIN is already linked to an account. If it's yours, contact support.");
    });

    it('an invalid GSTIN → 400 GSTIN_INVALID', async () => {
      const user = await newBusiness();
      const res = await submit(user, submitBody(user, { gstin: '24AAACC0000C1ZA' }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('GSTIN_INVALID');
    });

    it('no entered details and no lookup → 400; both → 400', async () => {
      const user = await newBusiness();
      const { entered: _entered, ...withoutEntered } = submitBody(user);
      const res = await submit(user, withoutEntered);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      const both = await submit(user, submitBody(user, { checkId: randomUUID() }));
      expect(both.status).toBe(400);
    });

    it('one file → 400 DOCUMENTS_REQUIRED; no certificate → 400; six files → 400', async () => {
      const user = await newBusiness();
      const uploadId = randomUUID();
      const one = await submit(user, submitBody(user, { uploadId, files: incomingFiles(user, uploadId, ['gst_certificate']) }));
      expect(one.status).toBe(400);
      expect(one.body.code).toBe('DOCUMENTS_REQUIRED');
      const noCert = await submit(user, submitBody(user, { uploadId, files: incomingFiles(user, uploadId, ['id_proof', 'authorisation_letter']) }));
      expect(noCert.status).toBe(400);
      expect(noCert.body.code).toBe('DOCUMENTS_REQUIRED');
      const noId = await submit(user, submitBody(user, { uploadId, files: incomingFiles(user, uploadId, ['gst_certificate', 'gst_certificate']) }));
      expect(noId.status).toBe(400);
      expect(noId.body.code).toBe('DOCUMENTS_REQUIRED');
      const six = await submit(
        user,
        submitBody(user, { uploadId, files: incomingFiles(user, uploadId, ['gst_certificate', 'id_proof', 'id_proof', 'id_proof', 'id_proof', 'id_proof']) }),
      );
      expect(six.status).toBe(400);
      expect(six.body.code).toBe('DOCUMENTS_REQUIRED');
    });

    it('storage unset → 503 STORAGE_UNAVAILABLE, and nothing is written', async () => {
      clearStorageEnv();
      const user = await newBusiness();
      const res = await submit(user, submitBody(user));
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('STORAGE_UNAVAILABLE');
      expect(await db.select().from(gstRepresentativeProofs).where(eq(gstRepresentativeProofs.businessId, user.businessId))).toHaveLength(0);
      expect((await business(user.businessId)).verificationStatus).toBe('not_submitted');
    });

    it("a lookup that isn't 'found' or isn't this business's → refused (R8)", async () => {
      const user = await newBusiness();
      const other = await newBusiness();
      const { gstin: heldGstin } = await grantTestGst(other.businessId);
      // A held lookup: its details belong to the other business.
      const held = await call(user.token, 'POST', '/businesses/me/gst/lookup', { gstin: heldGstin });
      expect(held.body.data).toMatchObject({ held: true });
      const [heldCheck] = await db.select().from(gstChecks).where(eq(gstChecks.businessId, user.businessId));
      expect(heldCheck!.result).toBe('held');
      const { entered: _e, ...body } = submitBody(user, { gstin: heldGstin, checkId: heldCheck!.id });
      const res = await submitReview(db, { userId: user.userId, businessId: user.businessId }, body, { stage: fakeStage, remove: async () => {} })
        .then(() => null)
        .catch((err: { statusCode: number; code: string }) => err);
      // The held GSTIN is refused as taken before the lookup is even looked at.
      expect(res).toMatchObject({ statusCode: 409 });

      const cancelled = await call(user.token, 'POST', '/businesses/me/gst/lookup', { gstin: STUB_GSTIN_CANCELLED });
      expect(cancelled.status).toBe(200);
      const [refused] = await db
        .select()
        .from(gstChecks)
        .where(and(eq(gstChecks.businessId, user.businessId), eq(gstChecks.result, 'status_refused')));
      const { entered: _e2, ...body2 } = submitBody(user, { gstin: STUB_GSTIN_CANCELLED, checkId: refused!.id });
      await expect(
        submitReview(db, { userId: user.userId, businessId: user.businessId }, body2, { stage: fakeStage, remove: async () => {} }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'GST_CHECK_NOT_USABLE' });

      // Another business's found lookup → 404.
      const otherLook = await newBusiness();
      const g = uniqueTestGstin();
      const looked = await call(otherLook.token, 'POST', '/businesses/me/gst/lookup', { gstin: g });
      const { entered: _e3, ...body3 } = submitBody(user, { gstin: g, checkId: (looked.body.data as GstStateView).checkId });
      await expect(
        submitReview(db, { userId: user.userId, businessId: user.businessId }, body3, { stage: fakeStage, remove: async () => {} }),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(await db.select().from(gstRepresentativeProofs).where(eq(gstRepresentativeProofs.businessId, user.businessId))).toHaveLength(0);
    });

    it('late code: an open code attempt is spent by the submission, and otp/verify → 409 GST_REVIEW_OPEN', async () => {
      const user = await newBusiness();
      const gstin = uniqueTestGstin();
      const looked = await call(user.token, 'POST', '/businesses/me/gst/lookup', { gstin });
      const checkId = (looked.body.data as GstStateView).checkId!;
      const declared = await call(user.token, 'POST', '/businesses/me/gst/declare', { checkId });
      const codeProofId = (declared.body.data as GstStateView).proofId!;
      expect((await call(user.token, 'POST', '/businesses/me/gst/otp/send', { proofId: codeProofId })).status).toBe(200);

      const removed: string[][] = [];
      const { entered: _e, ...body } = submitBody(user, { gstin, checkId });
      const view = await submitReview(db, { userId: user.userId, businessId: user.businessId }, body, {
        stage: fakeStage,
        remove: async (keys) => {
          removed.push(keys);
        },
      });
      expect(view).toMatchObject({ state: 'under_review', gstin, checkId });
      // After the commit, the incoming files are deleted (Task 9's order).
      expect(removed).toEqual([body.files.map((f) => f.key)]);

      expect((await proof(codeProofId)).status).toBe('spent');
      const review = await proof(view.proofId!);
      expect(review).toMatchObject({ method: 'documents', status: 'waiting', checkId, entered: null, declarationVersion: DECLARATION_VERSION });
      expect(review.documents).toHaveLength(2);
      expect(review.documents.every((d) => d.key.startsWith(`verification/${user.businessId}/${review.id}/`))).toBe(true);
      expect(await business(user.businessId)).toMatchObject({ verificationStatus: 'pending', verificationNote: null });

      const verified = await call(user.token, 'POST', '/businesses/me/gst/otp/verify', { proofId: codeProofId, code: '123456' });
      expect(verified.status).toBe(409);
      expect(verified.body.code).toBe('GST_REVIEW_OPEN');
      const b = await business(user.businessId);
      expect(b.gstin).toBeNull();
      expect(b.verificationLevels).not.toContain('gst');
    });

    it('a failure after staging deletes the copies, not the incoming files', async () => {
      const user = await newBusiness();
      const removed: string[][] = [];
      let copied: string[] = [];
      const body = submitBody(user);
      // A review opened (another tab) while the files were being copied: the transaction's re-check refuses it.
      const racingStage: StageFn = async (input) => {
        const staged = await fakeStage(input);
        copied = staged.copied.map((c) => c.key);
        await insertTestReview(user.businessId);
        return staged;
      };
      await expect(
        submitReview(db, { userId: user.userId, businessId: user.businessId }, body, {
          stage: racingStage,
          remove: async (keys) => {
            removed.push(keys);
          },
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'GST_REVIEW_OPEN' });
      expect(removed).toEqual([copied]);
    });

    it('add files on needs_more → waiting, summary pending, note cleared; refused when not needs_more, none or over 5 new', async () => {
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId);
      const actor = { userId: user.userId, businessId: user.businessId };
      const opts = { stage: fakeStage, remove: async () => {} };

      await expect(
        addReviewFiles(db, actor, proofId, { files: incomingFiles(user, proofId, ['id_proof']) }, opts),
      ).rejects.toMatchObject({ statusCode: 409, code: 'GST_REVIEW_STATE' });

      expect((await askForMore(proofId, 'The certificate is blurred')).status).toBe(200);
      await expect(addReviewFiles(db, actor, proofId, { files: [] }, opts)).rejects.toMatchObject({
        statusCode: 400,
        code: 'DOCUMENTS_REQUIRED',
      });
      await expect(
        addReviewFiles(db, actor, proofId, { files: incomingFiles(user, proofId, Array<GstDocumentType>(6).fill('id_proof')) }, opts),
      ).rejects.toMatchObject({ statusCode: 400, code: 'DOCUMENTS_REQUIRED' });

      const view = await addReviewFiles(db, actor, proofId, { files: incomingFiles(user, proofId, ['gst_certificate']) }, opts);
      expect(view).toMatchObject({ state: 'under_review', proofId });
      const p = await proof(proofId);
      expect(p.status).toBe('waiting');
      expect(p.documents).toHaveLength(3);
      expect(await business(user.businessId)).toMatchObject({ verificationStatus: 'pending', verificationNote: null });
    });

    it('a review sent back with 4 or 5 files takes 1–5 more, up to 10 in all (amendment to §5.3)', async () => {
      const opts = { stage: fakeStage, remove: async () => {} };
      const four: Array<{ type: GstDocumentType }> = [{ type: 'gst_certificate' }, { type: 'id_proof' }, { type: 'id_proof' }, { type: 'authorisation_letter' }];

      // 4 files: 5 more fit (9).
      const a = await newBusiness();
      const ra = await insertTestReview(a.businessId, { status: 'needs_more', documents: four });
      expect(await state(a)).toMatchObject({ state: 'needs_more', documentCount: 4 });
      const actorA = { userId: a.userId, businessId: a.businessId };
      const va = await addReviewFiles(db, actorA, ra.proofId, { files: incomingFiles(a, ra.proofId, Array<GstDocumentType>(5).fill('id_proof')) }, opts);
      expect(va).toMatchObject({ state: 'under_review', documentCount: 9 });
      expect((await proof(ra.proofId)).documents).toHaveLength(9);

      // 5 files: 5 more fit (10); sent back again, one more is over the cap.
      const b = await newBusiness();
      const rb = await insertTestReview(b.businessId, { status: 'needs_more', documents: [...four, { type: 'id_proof' }] });
      const actorB = { userId: b.userId, businessId: b.businessId };
      await addReviewFiles(db, actorB, rb.proofId, { files: incomingFiles(b, rb.proofId, Array<GstDocumentType>(5).fill('gst_certificate')) }, opts);
      expect((await proof(rb.proofId)).documents).toHaveLength(10);
      expect((await askForMore(rb.proofId, 'One page is still missing')).status).toBe(200);
      await expect(
        addReviewFiles(db, actorB, rb.proofId, { files: incomingFiles(b, rb.proofId, ['id_proof']) }, opts),
      ).rejects.toMatchObject({ statusCode: 400, code: 'DOCUMENTS_REQUIRED' });
      expect((await proof(rb.proofId)).status).toBe('needs_more');
    });

    it('added files still need the certificate and an ID or letter across the whole review', async () => {
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId, {
        status: 'needs_more',
        documents: [{ type: 'id_proof' }, { type: 'id_proof' }],
      });
      const actor = { userId: user.userId, businessId: user.businessId };
      const opts = { stage: fakeStage, remove: async () => {} };
      await expect(
        addReviewFiles(db, actor, proofId, { files: incomingFiles(user, proofId, ['authorisation_letter']) }, opts),
      ).rejects.toMatchObject({ statusCode: 400, code: 'DOCUMENTS_REQUIRED' });
      const view = await addReviewFiles(db, actor, proofId, { files: incomingFiles(user, proofId, ['gst_certificate']) }, opts);
      expect(view.state).toBe('under_review');
    });

    it('add files with storage unset → 503 (route)', async () => {
      clearStorageEnv();
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId, { status: 'needs_more' });
      const res = await call(user.token, 'POST', '/businesses/me/gst/review/files', {
        proofId,
        files: incomingFiles(user, proofId, ['id_proof']),
      });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('STORAGE_UNAVAILABLE');
    });
  });

  describe('officer decisions', () => {
    it('mode review: approve with an edited legal name → verified with it, method officer_review, verified_at set', async () => {
      process.env.GST_PROVIDER = 'off';
      const user = await newBusiness();
      const { proofId, gstin } = await insertTestReview(user.businessId);
      const res = await approve(proofId, { legalName: 'Corrected Engineering Pvt Ltd' });
      expect(res.status).toBe(200);

      const b = await business(user.businessId);
      expect(b).toMatchObject({ gstin, legalName: 'Corrected Engineering Pvt Ltd', verificationStatus: 'approved', verificationNote: null });
      expect(b.verifiedAt).toBeInstanceOf(Date);
      expect(b.verificationLevels).toContain('gst');
      expect(b.gstAddress).toMatchObject({ pincode: '382415' });
      const [v] = await db.select().from(businessVerifications).where(eq(businessVerifications.businessId, user.businessId));
      expect(v).toMatchObject({ method: 'officer_review', status: 'active', verifiedByAdminId: officer.id, verifiedByProofId: proofId });
      const p = await proof(proofId);
      expect(p).toMatchObject({ status: 'approved', officerId: officer.id, lookupAtApproval: 'none' });
      expect(p.approvedDetails).toMatchObject({ legalName: 'Corrected Engineering Pvt Ltd', tradeName: 'Typed Works', status: 'active' });
      expect(await auditRows(proofId, 'gst_review.approve')).toHaveLength(1);
      expect(await state(user)).toMatchObject({ state: 'verified', gstin });
      // No lookup at approval in mode review.
      expect(await db.select().from(gstChecks).where(eq(gstChecks.businessId, user.businessId))).toHaveLength(0);
    });

    it('mode stub: a cancelled GSTIN → 409 GST_NOT_ACTIVE, the review stays waiting', async () => {
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId, { gstin: STUB_GSTIN_CANCELLED });
      const res = await approve(proofId);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GST_NOT_ACTIVE');
      expect((await proof(proofId)).status).toBe('waiting');
      expect((await business(user.businessId)).verificationStatus).toBe('pending');
      expect(await auditRows(proofId, 'gst_review.approve')).toHaveLength(0);
    });

    it('mode stub: provider unreachable → approved from the entered details, lookup_at_approval unavailable', async () => {
      const user = await newBusiness();
      const gstin = uniqueTestGstin();
      setStubGstin(gstin, 'unavailable');
      const { proofId } = await insertTestReview(user.businessId, { gstin });
      const res = await approve(proofId, { constitution: 'Partnership' });
      expect(res.status).toBe(200);
      const p = await proof(proofId);
      expect(p).toMatchObject({ status: 'approved', lookupAtApproval: 'unavailable' });
      expect(p.approvedDetails).toMatchObject({ legalName: 'Typed Engineering Pvt Ltd', constitution: 'Partnership' });
      expect(await business(user.businessId)).toMatchObject({ gstin, constitution: 'Partnership', verificationStatus: 'approved' });
      const checks = await db.select().from(gstChecks).where(eq(gstChecks.businessId, user.businessId));
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({ source: 'officer', adminId: officer.id, result: 'failed', userId: null });
    });

    it('mode stub: an active fresh lookup decides the details (edits ignored), recorded as an officer lookup', async () => {
      const user = await newBusiness();
      const { proofId, gstin } = await insertTestReview(user.businessId);
      const res = await approve(proofId, { legalName: 'Ignored Name' });
      expect(res.status).toBe(200);
      const pan = gstin.slice(2, 12);
      expect(await business(user.businessId)).toMatchObject({ gstin, legalName: `Sample Engineering ${pan}` });
      expect(await proof(proofId)).toMatchObject({ lookupAtApproval: 'active' });
      const checks = await db.select().from(gstChecks).where(eq(gstChecks.businessId, user.businessId));
      expect(checks).toMatchObject([{ source: 'officer', adminId: officer.id, result: 'found', gstStatus: 'active' }]);
    });

    it('double approve → the second gets 409 STALE_REVIEW, one audit row', async () => {
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId);
      const [first, second] = await Promise.all([approve(proofId), approve(proofId)]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      expect([first, second].find((r) => r.status === 409)!.body.code).toBe('STALE_REVIEW');
      const third = await approve(proofId);
      expect(third.status).toBe(409);
      expect(third.body.code).toBe('STALE_REVIEW');
      expect(await auditRows(proofId, 'gst_review.approve')).toHaveLength(1);
      expect(await db.select().from(businessVerifications).where(eq(businessVerifications.businessId, user.businessId))).toHaveLength(1);
    });

    it('reject → summary rejected with the reason; state rejected; a second decision → STALE_REVIEW', async () => {
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId);
      const short = await reject(proofId, 'no');
      expect(short.status).toBe(400);
      expect(short.body).toMatchObject({ code: 'VALIDATION_ERROR', error: 'A reason of 3 to 500 characters is required', details: { field: 'reason' } });
      const res = await reject(proofId, 'The certificate is for another business');
      expect(res.status).toBe(200);
      expect(await business(user.businessId)).toMatchObject({
        verificationStatus: 'rejected',
        verificationNote: 'The certificate is for another business',
      });
      expect(await proof(proofId)).toMatchObject({ status: 'rejected', reason: 'The certificate is for another business', officerId: officer.id });
      expect(await state(user)).toMatchObject({ state: 'rejected', reason: 'The certificate is for another business', instantAllowed: true });
      expect(await auditRows(proofId, 'gst_review.reject')).toHaveLength(1);
      const again = await askForMore(proofId, 'Send the certificate again');
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('STALE_REVIEW');
    });

    it('a review in needs_more can be rejected (it is never stuck): summary rejected, state rejected', async () => {
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId, { status: 'needs_more' });
      const res = await reject(proofId, 'No reply to the request for more files');
      expect(res.status).toBe(200);
      expect(await proof(proofId)).toMatchObject({ status: 'rejected', reason: 'No reply to the request for more files', officerId: officer.id });
      expect(await business(user.businessId)).toMatchObject({ verificationStatus: 'rejected', verificationNote: 'No reply to the request for more files' });
      expect(await state(user)).toMatchObject({ state: 'rejected' });
      const [row] = await auditRows(proofId, 'gst_review.reject');
      expect(row!.before).toMatchObject({ status: 'needs_more' });
    });

    it('double reject (waiting and needs_more) → one 200, one 409 STALE_REVIEW, one audit row', async () => {
      for (const status of ['waiting', 'needs_more'] as const) {
        const user = await newBusiness();
        const { proofId } = await insertTestReview(user.businessId, { status });
        const [first, second] = await Promise.all([reject(proofId, 'Wrong certificate'), reject(proofId, 'Wrong certificate')]);
        expect([first.status, second.status].sort()).toEqual([200, 409]);
        expect([first, second].find((r) => r.status === 409)!.body.code).toBe('STALE_REVIEW');
        const third = await reject(proofId, 'Wrong certificate again');
        expect(third.status).toBe(409);
        expect(third.body.code).toBe('STALE_REVIEW');
        expect(await auditRows(proofId, 'gst_review.reject')).toHaveLength(1);
      }
    });

    it('ask for more → summary pending with the message, state needs_more', async () => {
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId);
      const res = await askForMore(proofId, 'Add a clearer photo of the certificate');
      expect(res.status).toBe(200);
      expect(await business(user.businessId)).toMatchObject({
        verificationStatus: 'pending',
        verificationNote: 'Add a clearer photo of the certificate',
      });
      expect(await state(user)).toMatchObject({ state: 'needs_more', officerMessage: 'Add a clearer photo of the certificate' });
      expect(await auditRows(proofId, 'gst_review.ask_for_more')).toHaveLength(1);
      // A review in needs_more can't be approved until the files come back.
      const approved = await approve(proofId);
      expect(approved.status).toBe(409);
      expect(approved.body.code).toBe('STALE_REVIEW');
    });

    it("a revoked business's review approved → verified, and instantAllowed stays false", async () => {
      const user = await newBusiness();
      const { gstin } = await grantTestGst(user.businessId);
      await revokeTestGst(user.businessId);
      const { proofId } = await insertTestReview(user.businessId, { gstin });
      const res = await approve(proofId);
      expect(res.status).toBe(200);
      expect(await state(user)).toMatchObject({ state: 'verified', gstin, instantAllowed: false });
    });

    it('a review for a different GSTIN after a revocation → approval replaces the GSTIN and frees the old one', async () => {
      const user = await newBusiness();
      const { gstin: oldGstin } = await grantTestGst(user.businessId);
      await revokeTestGst(user.businessId);
      const { proofId, gstin: newGstin } = await insertTestReview(user.businessId);
      expect((await approve(proofId)).status).toBe(200);
      const b = await business(user.businessId);
      expect(b.gstin).toBe(newGstin);
      expect(b.pan).toBe(newGstin.slice(2, 12));
      const [audit] = await auditRows(proofId, 'gst_review.approve');
      expect(audit!.after).toMatchObject({ gstin: newGstin, replacedGstin: oldGstin });
      // The old GSTIN is free: another business can take it.
      const other = await newBusiness();
      await expect(grantTestGst(other.businessId, oldGstin)).resolves.toMatchObject({ gstin: oldGstin });
    });

    it('race: two businesses’ reviews for one GSTIN approved at once → one 200, one 409 GSTIN_TAKEN', async () => {
      const a = await newBusiness();
      const b = await newBusiness();
      const gstin = uniqueTestGstin();
      const ra = await insertTestReview(a.businessId, { gstin });
      const rb = await insertTestReview(b.businessId, { gstin });
      const results = await Promise.all([approve(ra.proofId), approve(rb.proofId, undefined, superAdmin.token)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body.code).toBe('GSTIN_TAKEN');
      const holders = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.gstin, gstin));
      expect(holders).toHaveLength(1);
    });

    it("officer lookups don't count toward the business's 5 a day", async () => {
      const user = await newBusiness();
      const gstin = uniqueTestGstin();
      const { proofId } = await insertTestReview(user.businessId, { gstin });
      setStubGstin(gstin, 'cancelled');
      expect((await approve(proofId)).body.code).toBe('GST_NOT_ACTIVE');
      setStubGstin(gstin, 'not_found');
      expect((await approve(proofId)).body.code).toBe('GST_NOT_ACTIVE');
      // Both refused lookups are kept, as the officer's.
      const officerChecks = await db
        .select()
        .from(gstChecks)
        .where(and(eq(gstChecks.businessId, user.businessId), eq(gstChecks.source, 'officer')));
      expect(officerChecks.map((c) => c.result).sort()).toEqual(['not_found', 'status_refused']);
      expect(officerChecks.every((c) => c.adminId === officer.id)).toBe(true);

      expect((await reject(proofId, 'The GSTIN is not active')).status).toBe(200);
      setStubGstin(gstin, null);
      for (let i = 0; i < 5; i++) {
        expect((await call(user.token, 'POST', '/businesses/me/gst/lookup', { gstin: uniqueTestGstin() })).status).toBe(200);
      }
      const sixth = await call(user.token, 'POST', '/businesses/me/gst/lookup', { gstin: uniqueTestGstin() });
      expect(sixth.status).toBe(429);
    });

    it('officer edits win over the lookup: a cleared trade name shows the legal name', async () => {
      const user = await newBusiness();
      const { proofId, gstin } = await insertTestReview(user.businessId, { withCheck: true });
      // Provider down at approval: the officer's corrections apply to the attached lookup's details.
      setStubGstin(gstin, 'unavailable');
      expect((await approve(proofId, { tradeName: null })).status).toBe(200);
      const me = await app.inject({ method: 'GET', url: '/businesses/me', headers: { authorization: `Bearer ${user.token}` } });
      const pan = gstin.slice(2, 12);
      expect(me.json().data).toMatchObject({ nameLocked: true, displayName: `Sample Engineering ${pan}` });
    });

    it('support role → 403 on the queue and on decisions', async () => {
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId);
      expect((await call(support.token, 'GET', '/admin/verification/reviews?status=waiting')).status).toBe(403);
      expect((await approve(proofId, {}, support.token)).status).toBe(403);
      expect((await call(support.token, 'GET', `/admin/verification/documents/${proofId}/0/url`)).status).toBe(403);
    });

    it('an unknown review → 404', async () => {
      expect((await approve(randomUUID())).status).toBe(404);
      expect((await call(officer.token, 'GET', `/admin/verification/reviews/${randomUUID()}`)).status).toBe(404);
    });
  });

  describe('queue and detail', () => {
    it('lists waiting oldest first, needs_more, and decided (last 90 days)', async () => {
      const a = await newBusiness();
      const b = await newBusiness();
      const c = await newBusiness();
      const ra = await insertTestReview(a.businessId);
      const rb = await insertTestReview(b.businessId);
      const rc = await insertTestReview(c.businessId, { status: 'needs_more' });
      expect((await reject(rb.proofId, 'Wrong documents')).status).toBe(200);

      const list = async (status: string) =>
        ((await call(officer.token, 'GET', `/admin/verification/reviews?status=${status}`)).body.data as AdminGstReviewRow[]).map((r) => r.id);
      const waiting = await list('waiting');
      expect(waiting).toContain(ra.proofId);
      expect(waiting).not.toContain(rb.proofId);
      expect(await list('needs_more')).toContain(rc.proofId);
      const decided = await list('decided');
      expect(decided).toContain(rb.proofId);
      expect(decided).not.toContain(ra.proofId);

      // Older than 90 days drops out of Decided.
      await db
        .update(gstRepresentativeProofs)
        .set({ decidedAt: sql`now() - interval '91 days'` })
        .where(eq(gstRepresentativeProofs.id, rb.proofId));
      expect(await list('decided')).not.toContain(rb.proofId);

      const row = ((await call(officer.token, 'GET', '/admin/verification/reviews')).body.data as AdminGstReviewRow[]).find(
        (r) => r.id === ra.proofId,
      );
      expect(row).toMatchObject({ businessId: a.businessId, gstin: ra.gstin, status: 'waiting', hasLookup: false, documentCount: 2 });
      expect((await call(officer.token, 'GET', '/admin/verification/reviews?status=bogus')).status).toBe(400);
    });

    it('count: how many reviews wait (or need more), for the nav badge; officers only', async () => {
      const count = async (query = '') => {
        const res = await call(officer.token, 'GET', `/admin/verification/reviews/count${query}`);
        expect(res.status).toBe(200);
        return (res.body.data as { count: number }).count;
      };
      const waitingBefore = await count();
      const needsMoreBefore = await count('?status=needs_more');
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId);
      expect(await count('?status=waiting')).toBe(waitingBefore + 1);
      expect((await askForMore(proofId, 'Add the other page')).status).toBe(200);
      expect(await count()).toBe(waitingBefore);
      expect(await count('?status=needs_more')).toBe(needsMoreBefore + 1);
      expect((await call(officer.token, 'GET', '/admin/verification/reviews/count?status=decided')).status).toBe(400);
      expect((await call(support.token, 'GET', '/admin/verification/reviews/count')).status).toBe(403);
    });

    it('detail: entered details, documents without keys, mismatches, history, providerAvailable', async () => {
      const user = await newBusiness();
      await db.update(businesses).set({ pincode: '395003' }).where(eq(businesses.id, user.businessId));
      const { proofId, gstin } = await insertTestReview(user.businessId);
      const res = await call(officer.token, 'GET', `/admin/verification/reviews/${proofId}`);
      expect(res.status).toBe(200);
      const d = res.body.data as AdminGstReviewDetail;
      expect(d).toMatchObject({
        id: proofId,
        gstin,
        status: 'waiting',
        entered: testEntered(),
        lookup: null,
        mismatches: { legalName: true, pincode: true },
        providerAvailable: true,
        documents: [
          { index: 0, type: 'gst_certificate', format: 'pdf' },
          { index: 1, type: 'id_proof', format: 'jpg' },
        ],
      });
      expect(JSON.stringify(d)).not.toContain('verification/');
      expect(d.history.proofs.map((p) => p.id)).toContain(proofId);

      process.env.GST_PROVIDER = 'off';
      const inReview = (await call(officer.token, 'GET', `/admin/verification/reviews/${proofId}`)).body.data as AdminGstReviewDetail;
      expect(inReview.providerAvailable).toBe(false);
    });

    it('detail with a lookup attached shows it; a name that matches the GST trade name is no mismatch', async () => {
      const user = await newBusiness();
      const { proofId, gstin, checkId } = await insertTestReview(user.businessId, { withCheck: true });
      const pan = gstin.slice(2, 12);
      await db
        .update(businesses)
        .set({ tradeName: ` sample machine works ${pan.slice(5, 9).toLowerCase()} `, pincode: '382445' })
        .where(eq(businesses.id, user.businessId));
      const d = (await call(officer.token, 'GET', `/admin/verification/reviews/${proofId}`)).body.data as AdminGstReviewDetail;
      expect(d.entered).toBeNull();
      expect(d.lookup).toMatchObject({ checkId, details: { legalName: `Sample Engineering ${pan}` } });
      expect(d.mismatches).toEqual({ legalName: false, pincode: false });
    });
  });

  describe('document URLs', () => {
    it('storage unset → 503 STORAGE_UNAVAILABLE', async () => {
      clearStorageEnv();
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId);
      const res = await call(officer.token, 'GET', `/admin/verification/documents/${proofId}/0/url`);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('STORAGE_UNAVAILABLE');
    });

    it('a signed GET that serves the stored type inline, and an audit row per view; a bad index → 404', async () => {
      fakeStorageEnv();
      const user = await newBusiness();
      const { proofId } = await insertTestReview(user.businessId);
      const res = await call(officer.token, 'GET', `/admin/verification/documents/${proofId}/1/url`);
      expect(res.status).toBe(200);
      const data = res.body.data as { url: string; type: string; format: string; expiresAt: string };
      expect(data).toMatchObject({ type: 'id_proof', format: 'jpg' });
      const url = new URL(data.url);
      expect(url.searchParams.get('response-content-type')).toBe('image/jpeg');
      expect(url.searchParams.get('response-content-disposition')).toBe('inline');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      const audits = await auditRows(proofId, 'gst_document.view');
      expect(audits).toHaveLength(1);
      expect(audits[0]!.after).toMatchObject({ index: 1, type: 'id_proof' });

      expect((await call(officer.token, 'GET', `/admin/verification/documents/${proofId}/5/url`)).status).toBe(404);
    });

    it('presignDocumentRead sets the content type from the extension (pdf, png, webp)', async () => {
      fakeStorageEnv();
      const base = `verification/${randomUUID()}/${randomUUID()}/${randomUUID()}`;
      for (const [ext, type] of [
        ['pdf', 'application/pdf'],
        ['png', 'image/png'],
        ['webp', 'image/webp'],
      ] as const) {
        const url = new URL(await presignDocumentRead(`${base}.${ext}`));
        expect(url.searchParams.get('response-content-type')).toBe(type);
      }
    });
  });
});
