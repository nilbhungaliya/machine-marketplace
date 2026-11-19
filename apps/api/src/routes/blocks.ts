import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { refuseViewer } from '../lib/member-guard.js';
import { runTx } from '../lib/tx-effects.js';
import { listBlocks, unblock } from '../services/chat/block.service.js';

// Blocked businesses (F6 + F7 spec §6.11, §12.2): the list on Profile › Blocked businesses and unblock.

const tags = ['Chat'];
const params = z.object({ businessId: z.string().uuid() });

const blockRoutes: FastifyPluginAsync = async (fastify) => {
  // → `{ items: [{ businessId, name, blockedAt }] }`.
  fastify.get('/users/me/blocks', { schema: { tags }, preHandler: [fastify.requireUser] }, async (request) => {
    return { data: await listBlocks(fastify.db, request.user!) };
  });
  // → `{ blocked: false }`, always.
  fastify.delete(
    '/users/me/blocks/:businessId',
    { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer] },
    async (request) => {
      const { businessId } = params.parse(request.params);
      return { data: await runTx(fastify, (tx) => unblock(tx, request.user!, businessId)) };
    },
  );
};

export default blockRoutes;
