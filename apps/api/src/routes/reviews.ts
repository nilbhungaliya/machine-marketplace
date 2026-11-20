import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { REVIEW_REPORT_REASONS } from '@mpm/shared-types';
import { refuseViewer } from '../lib/member-guard.js';
import { runTx } from '../lib/tx-effects.js';
import { runIdempotent } from '../services/idempotency.service.js';
import { reportReview } from '../services/reviews/review-moderation.service.js';
import { getReviewState } from '../services/reviews/review-state.js';
import { listSellerReviews, myReceivedReviews, postReply, submitReview } from '../services/reviews/review.service.js';

// Reviews (F6 + F7 spec §10, §12.2). L4 owns this file.

const tags = ['Reviews'];

const idParams = z.object({ id: z.string().uuid() });
const cursorQuery = z.object({ cursor: z.string().max(500).optional() });
// Ratings are checked by the service (`400 REVIEW_ANSWERS_INVALID`), so the schema only bounds the shape and size.
const reviewBody = z
  .object({ ratings: z.record(z.string().max(40), z.unknown()), text: z.string().max(5000).nullable().optional() })
  .strict();
const replyBody = z.object({ text: z.string().max(2000) }).strict();
const reportBody = z.object({ reason: z.enum(REVIEW_REPORT_REASONS), details: z.string().max(2000).nullable().optional() }).strict();

const reviewRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  const write = { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer] };
  const idempotentWrite = { ...write, config: { idempotent: true } };

  fastify.get('/deals/:id/review', read, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await getReviewState(fastify.db, request.user!, id) };
  });

  fastify.post('/deals/:id/review', idempotentWrite, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = reviewBody.parse(request.body ?? {});
    return runIdempotent(request, reply, fastify, async (tx) => ({
      status: 200,
      body: { data: await submitReview(tx, request.user!, id, body) },
    }));
  });

  // M14 (spec R11, plan C0-4): a rental booking's review, F6's rules with the rental facets. Lane A3 builds them
  // (`services/reviews/rental-review.service.ts`); reply / report / hide use the routes by review id below.
  fastify.get('/rental-bookings/:id/review', read, async (_request, reply) =>
    // M14-STUB(A3)
    reply.code(501).send({ error: 'Not implemented yet', code: 'NOT_IMPLEMENTED' }),
  );
  fastify.post('/rental-bookings/:id/review', idempotentWrite, async (_request, reply) =>
    // M14-STUB(A3)
    reply.code(501).send({ error: 'Not implemented yet', code: 'NOT_IMPLEMENTED' }),
  );

  fastify.post('/reviews/:id/reply', idempotentWrite, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { text } = replyBody.parse(request.body ?? {});
    return runIdempotent(request, reply, fastify, async (tx) => ({
      status: 200,
      body: { data: await postReply(tx, request.user!, id, text) },
    }));
  });

  fastify.post('/reviews/:id/report', write, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = reportBody.parse(request.body ?? {});
    return { data: await runTx(fastify, (tx) => reportReview(tx, request.user!, id, body)) };
  });

  // Public: guests too (`optionalUser`).
  fastify.get('/businesses/:id/reviews', { schema: { tags }, preHandler: [fastify.optionalUser] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { cursor } = cursorQuery.parse(request.query);
    return { data: await listSellerReviews(fastify.db, id, cursor) };
  });

  fastify.get('/users/me/reviews', read, async (request) => {
    const { cursor } = cursorQuery.parse(request.query);
    return { data: await myReceivedReviews(fastify.db, request.user!, cursor) };
  });
};

export default reviewRoutes;
