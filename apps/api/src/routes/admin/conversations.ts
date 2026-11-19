import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../../lib/member-guard.js';

// Admin conversation reads (F6 + F7 spec §16.3, R23): only with an open report or dispute, reason required, every read
// audit-logged. L1 owns this file (L1-5); C0-4b stub. Roles: moderator, support (the dispute read is support's).

const tags = ['Admin conversations'];

const adminConversationRoutes: FastifyPluginAsync = async (fastify) => {
  // F6F7-STUB(L1): L1-5 → `AdminThreadRead`. Read basis per role: an open dispute on one of the thread's deals counts
  // only for `support` (and `super_admin`); a `moderator` needs an open conversation report on the thread.
  fastify.post(
    '/admin/threads/:id/read',
    { schema: { tags }, preHandler: fastify.requireAdminRole('moderator', 'support') },
    async () => notImplemented(),
  );
};

export default adminConversationRoutes;
