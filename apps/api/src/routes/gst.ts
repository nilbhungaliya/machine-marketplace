import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { GST_DOCUMENT_TYPES } from '@mpm/shared-types';
import { TooManyRequestsError } from '../lib/errors.js';
import { perUser } from '../lib/per-user-limit.js';
import { presignDocumentUpload } from '../services/verification/gst-documents.service.js';
import { declare, lookupGst, sendGstCode, verifyGstCode, type GstActor } from '../services/verification/gst-instant.service.js';
import { addReviewFiles, submitReview } from '../services/verification/gst-review.service.js';
import { getGstState, noBusiness } from '../services/verification/gst-state.service.js';

// GST verification for the signed-in user's business (F1 + A2 spec §5, §10). Thin: validate → service → `{ data }`.

const tags = ['GST verification'];

const uuid = z.string().uuid();
const lookupBody = z.object({ gstin: z.string().min(1).max(40) }).strict();
const declareBody = z.object({ checkId: uuid }).strict();
const proofBody = z.object({ proofId: uuid }).strict();
const verifyBody = z.object({ proofId: uuid, code: z.string().regex(/^\d{4,8}$/, 'must be the code you received') }).strict();
// Type and size are checked in the service (400 DOCUMENT_TYPE / 413 MEDIA_TOO_LARGE), after the 503 when storage is unset.
const presignBody = z
  .object({
    proofId: uuid.optional(),
    uploadId: uuid.optional(),
    contentType: z.string().min(1).max(100),
    size: z.number().int().positive(),
  })
  .strict();

// Path A (spec §5.3): the file rules (2–5 on submit, 1–5 more up to 10 in all after ask-for-more, certificate + ID /
// letter) and the details-iff-no-lookup rule are the service's (400 DOCUMENTS_REQUIRED); the schema only bounds sizes. Keys are checked by staging (DOCUMENT_KEY_INVALID).
const documentFile = z.object({ key: z.string().min(1).max(300), type: z.enum(GST_DOCUMENT_TYPES) }).strict();
const documentFiles = z.array(documentFile).max(10);
const gstAddress = z
  .object({
    line: z.string().trim().min(1).max(300),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().min(1).max(80),
    pincode: z.string().regex(/^[1-9]\d{5}$/, 'must be a 6-digit pincode'),
  })
  .strict();
const reviewBody = z
  .object({
    gstin: z.string().min(1).max(40),
    checkId: uuid.optional(),
    entered: z
      .object({
        legalName: z.string().trim().min(1).max(200),
        tradeName: z.string().trim().max(200).nullable().optional(),
        address: gstAddress,
        constitution: z.string().trim().min(1).max(100),
      })
      .strict()
      .optional(),
    declarationVersion: z.number().int().positive(),
    uploadId: uuid,
    files: documentFiles,
  })
  .strict();
const reviewFilesBody = z.object({ proofId: uuid, files: documentFiles }).strict();

/**
 * Lookups and code sends: 20 per user (spec §5.2 step 2: "plus the per-user … route rate limit"), on top of the
 * business's daily limit and the proof's send limit.
 */
const perUserLimit = perUser(20);
/** Document presigns: 30 per user (a review is 2–5 files, with retries), so a client can't mint signed PUTs in bulk. */
const presignLimit = perUser(30);

/** Per-IP route limit window (spec §5.2 "per-user and per-IP route rate limit"). */
const IP_WINDOW_SECONDS = 600;
const IP_DEFAULT_MAX = 60;

/**
 * Requests per IP per 10 minutes on lookup and on otp/send (each counted on its own): 60 by default, so several users
 * behind one office NAT fit; `GST_IP_RATE_MAX` overrides it (the test config raises it, one test lowers it). Read per
 * request, like the GST mode, so a test can change it.
 */
function ipMax(): number {
  const raw = process.env.GST_IP_RATE_MAX;
  if (raw === undefined || raw.trim() === '') return IP_DEFAULT_MAX;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`GST_IP_RATE_MAX must be a positive integer, got "${raw}"`);
  return n;
}

/** The signed-in user and their business; `404 NO_BUSINESS` before onboarding has created one. */
function actorOf(request: FastifyRequest): GstActor {
  const user = request.user!;
  if (!user.businessId) throw noBusiness();
  return { userId: user.userId, businessId: user.businessId };
}

const gstRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { schema: { tags }, preHandler: fastify.requireUser };

  /**
   * The per-IP counter (textile `routes/gst.ts` `lookupLimit`): one Redis counter per route and IP, its 10-minute
   * window starting at the first request. @fastify/rate-limit takes one config per route, which the per-user limit
   * uses. Over the limit → `429 RATE_LIMITED`, the code the rate-limit plugin's refusals map to.
   */
  const perIpLimit = (route: 'lookup' | 'otp-send') => async (request: FastifyRequest) => {
    const redis = fastify.redis;
    if (!redis) return; // Registered with the routes in buildApp; without it there is nothing to count in.
    const key = `rl:gst-ip:${route}:${request.ip}`;
    const result = await redis.multi().incr(key).expire(key, IP_WINDOW_SECONDS, 'NX').exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    if (count > ipMax()) throw new TooManyRequestsError('Too many requests', 'RATE_LIMITED');
  };
  const limited = (route: 'lookup' | 'otp-send') => ({
    schema: { tags },
    preHandler: [fastify.requireUser, perIpLimit(route)],
    config: perUserLimit,
  });

  fastify.get('/businesses/me/gst', auth, async (request) => ({
    data: await getGstState(fastify.db, actorOf(request).businessId),
  }));

  fastify.post('/businesses/me/gst/lookup', limited('lookup'), async (request) => {
    const { gstin } = lookupBody.parse(request.body);
    return { data: await lookupGst(fastify.db, actorOf(request), gstin) };
  });

  fastify.post('/businesses/me/gst/declare', auth, async (request) => {
    const { checkId } = declareBody.parse(request.body);
    return { data: await declare(fastify.db, actorOf(request), checkId) };
  });

  fastify.post('/businesses/me/gst/otp/send', limited('otp-send'), async (request) => {
    const { proofId } = proofBody.parse(request.body);
    return { data: await sendGstCode(fastify.db, actorOf(request), proofId) };
  });

  fastify.post('/businesses/me/gst/otp/verify', auth, async (request) => {
    const { proofId, code } = verifyBody.parse(request.body);
    return { data: await verifyGstCode(fastify.db, actorOf(request), proofId, code) };
  });

  // Path A (spec §5.3): submit a review, and add files to one the officer sent back (needs_more).
  fastify.post('/businesses/me/gst/review', auth, async (request) => {
    const body = reviewBody.parse(request.body);
    return { data: await submitReview(fastify.db, actorOf(request), body, { log: request.log }) };
  });

  fastify.post('/businesses/me/gst/review/files', auth, async (request) => {
    const { proofId, files } = reviewFilesBody.parse(request.body);
    return { data: await addReviewFiles(fastify.db, actorOf(request), proofId, { files }, { log: request.log }) };
  });

  // A signed PUT for one review document (spec §6); the review submission names the uploaded keys.
  fastify.post('/businesses/me/gst/documents/presign', { ...auth, config: presignLimit }, async (request) => {
    const body = presignBody.parse(request.body);
    return { data: await presignDocumentUpload(fastify.db, actorOf(request), body) };
  });
};

export default gstRoutes;
