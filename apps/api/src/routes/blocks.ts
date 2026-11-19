import type { FastifyPluginAsync } from 'fastify';
import { notImplemented, refuseViewer } from '../lib/member-guard.js';

// Blocked businesses (F6 + F7 spec §6.11, §12.2). L1 owns this file; C0-4b stubs.

const tags = ['Chat'];

const blockRoutes: FastifyPluginAsync = async (fastify) => {
  // F6F7-STUB(L1): L1-5 → the business's blocks.
  fastify.get('/users/me/blocks', { schema: { tags }, preHandler: [fastify.requireUser] }, async () => notImplemented());
  // F6F7-STUB(L1): L1-5 unblock.
  fastify.delete(
    '/users/me/blocks/:businessId',
    { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer] },
    async () => notImplemented(),
  );
};

export default blockRoutes;
