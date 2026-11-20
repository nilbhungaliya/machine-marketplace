import type { FastifyPluginAsync } from 'fastify';
import { groupRateLimit } from '../lib/group-limit.js';
import { refuseViewer } from '../lib/member-guard.js';
import { notImplemented } from './part-requests.js';

// Seller replies (F8 spec §9.2, §12.2; lane A2): the reply picker, send, withdraw, and a listing's demand line. The
// preHandlers and limits are final; the handlers are C0 stubs (`501 NOT_IMPLEMENTED`).

const tags = ['Part requests'];

const partRequestReplyRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  /** Send and withdraw (I): 20 per 10 minutes per user across the group (plan D10). */
  const replyWrite = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('part_request_reply', 20, 600)],
    config: { idempotent: true },
  };

  fastify.get('/part-requests/:id/reply-options', read, async () => {
    throw notImplemented(); // F8-STUB(A2)
  });
  fastify.post('/part-requests/:id/replies', replyWrite, async () => {
    throw notImplemented(); // F8-STUB(A2)
  });
  fastify.post('/part-requests/:id/replies/:replyId/withdraw', replyWrite, async () => {
    throw notImplemented(); // F8-STUB(A2)
  });
  fastify.get('/listings/:id/part-request-demand', read, async () => {
    throw notImplemented(); // F8-STUB(A2)
  });
};

export default partRequestReplyRoutes;
