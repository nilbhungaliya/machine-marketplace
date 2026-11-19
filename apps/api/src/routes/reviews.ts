import type { FastifyPluginAsync } from 'fastify';
import { notImplemented, refuseViewer } from '../lib/member-guard.js';

// Reviews (F6 + F7 spec §10, §12.2). L4 owns this file; C0-4b stubs.

const tags = ['Reviews'];

const reviewRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  const write = { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer] };
  const idempotentWrite = { ...write, config: { idempotent: true } };

  // F6F7-STUB(L4): L4-1 → `ReviewState`.
  fastify.get('/deals/:id/review', read, async () => notImplemented());
  fastify.post('/deals/:id/review', idempotentWrite, async () => notImplemented());
  // F6F7-STUB(L4): L4-2 → `PublicReview`.
  fastify.post('/reviews/:id/reply', idempotentWrite, async () => notImplemented());
  // F6F7-STUB(L4): L4-2 report a review.
  fastify.post('/reviews/:id/report', write, async () => notImplemented());
  // F6F7-STUB(L4): L4-2 public → `SellerReviewsPage`.
  fastify.get('/businesses/:id/reviews', { schema: { tags }, preHandler: [fastify.optionalUser] }, async () => notImplemented());
  // F6F7-STUB(L4): L4-2 my seller score and reviews received.
  fastify.get('/users/me/reviews', read, async () => notImplemented());
};

export default reviewRoutes;
