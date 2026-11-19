import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../../lib/member-guard.js';

// Admin review moderation (F6 + F7 spec §10.5, §16.2, P9). L4 owns this file (L4-2); C0-4b stubs. Role: moderator.
// Each writes `audit_log` (`review.hide`, `review.unhide`, `review.hide_reply`).

const tags = ['Admin reviews'];

const adminReviewRoutes: FastifyPluginAsync = async (fastify) => {
  const moderator = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator') };
  // F6F7-STUB(L4): L4-2 `{ reason }`.
  fastify.post('/admin/reviews/:id/hide', moderator, async () => notImplemented());
  fastify.post('/admin/reviews/:id/unhide', moderator, async () => notImplemented());
  fastify.post('/admin/reviews/:id/hide-reply', moderator, async () => notImplemented());
};

export default adminReviewRoutes;
