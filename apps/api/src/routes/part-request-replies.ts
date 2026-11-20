import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { PART_REQUEST_LIMITS } from '@mpm/shared-types';
import { groupRateLimit } from '../lib/group-limit.js';
import { refuseViewer } from '../lib/member-guard.js';
import { isStorableText } from '../lib/spec-check.js';
import { runIdempotent } from '../services/idempotency.service.js';
import { listingDemand } from '../services/part-requests/demand.js';
import { replyOptions } from '../services/part-requests/reply-options.js';
import { sendReplies, withdrawReply } from '../services/part-requests/reply.service.js';

// Seller replies (F8 spec §9.2, §12.2; lane A2): the reply picker, send, withdraw, and a listing's demand line. Thin:
// Zod-parse → service → `{ data }`. Writes run in `runIdempotent` (optional `Idempotency-Key`).

const tags = ['Part requests'];

const idParams = z.object({ id: z.string().uuid() });
const replyParams = z.object({ id: z.string().uuid(), replyId: z.string().uuid() });
const sendBody = z
  .object({
    listingIds: z.array(z.string().uuid()).min(1).max(PART_REQUEST_LIMITS.replyListingsPerCall),
    message: z
      .string()
      .max(PART_REQUEST_LIMITS.messageMax)
      .refine(isStorableText, 'contains characters that cannot be saved')
      .nullable()
      .optional(),
  })
  .strict();
const emptyBody = z.object({}).strict();

const partRequestReplyRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  /** Send and withdraw (I): 20 per 10 minutes per user across the group (plan D10). */
  const replyWrite = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('part_request_reply', 20, 600)],
    config: { idempotent: true },
  };

  fastify.get('/part-requests/:id/reply-options', read, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await replyOptions(fastify.db, request.user!, id) };
  });

  fastify.post('/part-requests/:id/replies', replyWrite, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = sendBody.parse(request.body ?? {});
    return runIdempotent(request, reply, fastify, async (tx) => ({
      status: 200,
      body: { data: await sendReplies(tx, request.user!, id, body) },
    }));
  });

  fastify.post('/part-requests/:id/replies/:replyId/withdraw', replyWrite, async (request, reply) => {
    const { id, replyId } = replyParams.parse(request.params);
    emptyBody.parse(request.body ?? {});
    return runIdempotent(request, reply, fastify, async (tx) => ({
      status: 200,
      body: { data: await withdrawReply(tx, request.user!, id, replyId) },
    }));
  });

  fastify.get('/listings/:id/part-request-demand', read, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await listingDemand(fastify.db, request.user!, id) };
  });
};

export default partRequestReplyRoutes;
