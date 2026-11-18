import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { GST_REVIEW_FILES_TOTAL_MAX, GST_REVIEW_QUEUES } from '@mpm/shared-types';
import { messageBody, reasonBody } from '../../lib/admin-text.js';
import {
  approveReview,
  askForMore,
  countReviews,
  documentUrl,
  getReviewDetail,
  listReviews,
  rejectReview,
} from '../../services/verification/gst-review.service.js';

const tags = ['Admin Verification'];

const idParams = z.object({ id: z.string().uuid() });
const documentParams = z.object({ proofId: z.string().uuid(), index: z.coerce.number().int().min(0).max(GST_REVIEW_FILES_TOTAL_MAX - 1) });
const listQuery = z.object({ status: z.enum(GST_REVIEW_QUEUES).default('waiting') }).strict();
const countQuery = z.object({ status: z.enum(['waiting', 'needs_more']).default('waiting') }).strict();
const approveBody = z
  .object({
    legalName: z.string().trim().min(1).max(200).optional(),
    tradeName: z.string().trim().max(200).nullable().optional(),
    address: z
      .object({
        line: z.string().trim().min(1).max(300),
        city: z.string().trim().min(1).max(80),
        state: z.string().trim().min(1).max(80),
        pincode: z.string().regex(/^[1-9]\d{5}$/, 'must be a 6-digit pincode'),
      })
      .strict()
      .optional(),
    constitution: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

// The Business verification page (F1 + A2 spec §8.1, §10). Thin: validate → service → `{ data }`. Verification
// officers only (super_admin passes every role check); every decision and every document URL is audit-logged.
const adminVerificationRoutes: FastifyPluginAsync = async (fastify) => {
  const officer = { schema: { tags }, preHandler: fastify.requireAdminRole('verification_officer') };
  const noStore = { 'Cache-Control': 'private, no-store' };

  fastify.get('/admin/verification/reviews', officer, async (request) => {
    const { status } = listQuery.parse(request.query);
    return { data: await listReviews(fastify.db, status) };
  });

  // The nav badge's count (no 200-row cap, no rows downloaded). Static, so it wins over `/reviews/:id`.
  fastify.get('/admin/verification/reviews/count', officer, async (request) => {
    const { status } = countQuery.parse(request.query);
    return { data: { count: await countReviews(fastify.db, status) } };
  });

  fastify.get('/admin/verification/reviews/:id', officer, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers(noStore);
    return { data: await getReviewDetail(fastify.db, id) };
  });

  fastify.post('/admin/verification/reviews/:id/approve', officer, async (request) => {
    const { id } = idParams.parse(request.params);
    const edits = approveBody.parse(request.body ?? {});
    const outcome = await fastify.db.transaction((tx) => approveReview(tx, request.admin!.adminId, id, edits));
    // A refusal that keeps its writes (the officer's lookup) is thrown after the commit.
    if (outcome.kind === 'refused') throw outcome.error;
    return { data: outcome.review };
  });

  fastify.post('/admin/verification/reviews/:id/reject', officer, async (request) => {
    const { id } = idParams.parse(request.params);
    const { reason } = reasonBody.parse(request.body ?? {});
    return { data: await fastify.db.transaction((tx) => rejectReview(tx, request.admin!.adminId, id, reason)) };
  });

  fastify.post('/admin/verification/reviews/:id/ask-for-more', officer, async (request) => {
    const { id } = idParams.parse(request.params);
    const { message } = messageBody.parse(request.body ?? {});
    return { data: await fastify.db.transaction((tx) => askForMore(tx, request.admin!.adminId, id, message)) };
  });

  fastify.get('/admin/verification/documents/:proofId/:index/url', officer, async (request, reply) => {
    const { proofId, index } = documentParams.parse(request.params);
    reply.headers(noStore);
    return { data: await fastify.db.transaction((tx) => documentUrl(tx, request.admin!.adminId, proofId, index)) };
  });
};

export default adminVerificationRoutes;
