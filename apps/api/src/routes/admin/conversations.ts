import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { reasonBody } from '../../lib/admin-text.js';
import { runTx } from '../../lib/tx-effects.js';
import { adminReadThread } from '../../services/chat/admin-read.service.js';

// Admin conversation reads (F6 + F7 spec §16.3, R23): only with a report or a dispute (an open dispute counts only for
// `support` and `super_admin`), reason required, every read audit-logged. Roles: moderator, support.

const tags = ['Admin conversations'];
const params = z.object({ id: z.string().uuid() });

const adminConversationRoutes: FastifyPluginAsync = async (fastify) => {
  // → `AdminThreadRead`.
  fastify.post(
    '/admin/threads/:id/read',
    { schema: { tags }, preHandler: fastify.requireAdminRole('moderator', 'support') },
    async (request) => {
      const { id } = params.parse(request.params);
      const { reason } = reasonBody.parse(request.body);
      return { data: await runTx(fastify, (tx) => adminReadThread(tx, request.admin!, id, reason)) };
    },
  );
};

export default adminConversationRoutes;
