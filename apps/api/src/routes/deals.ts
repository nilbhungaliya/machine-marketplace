import type { FastifyPluginAsync } from 'fastify';
import { DEAL_LIMITS } from '@mpm/shared-types';
import { groupRateLimit } from '../lib/group-limit.js';
import { notImplemented, refuseViewer } from '../lib/member-guard.js';
import { perUser } from '../lib/per-user-limit.js';

// Deals (F6 + F7 spec §9, §12.2). L3 owns this file; C0-4b stubs. Every deal write counts in the `deal` group (20 / min).

const tags = ['Deals'];

const dealRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  const write = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('deal', DEAL_LIMITS.dealActionsPerMinute, 60)],
    config: { idempotent: true },
  };

  // F6F7-STUB(L3): L3-1 → `DealsPage`.
  fastify.get('/deals', read, async () => notImplemented());
  // F6F7-STUB(L3): L3-1 → `DealView`.
  fastify.get('/deals/:id', read, async () => notImplemented());
  // F6F7-STUB(L3): L3-2 → `DealView`.
  fastify.patch('/deals/:id/notes', write, async () => notImplemented());
  // F6F7-STUB(L3): L3-2 → `{ url, key, expiresAt }`.
  fastify.post(
    '/deals/:id/photos/presign',
    { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer], config: perUser(DEAL_LIMITS.photoPresignPer10Min) },
    async () => notImplemented(),
  );
  // F6F7-STUB(L3): L3-2 → `DealView`.
  fastify.post('/deals/:id/hand-over', write, async () => notImplemented());
  fastify.post('/deals/:id/confirm-received', write, async () => notImplemented());
  fastify.post('/deals/:id/cancel', write, async () => notImplemented());
  fastify.post('/deals/:id/cancel-request', write, async () => notImplemented());
  fastify.post('/deals/:id/cancel-request/accept', write, async () => notImplemented());
  fastify.post('/deals/:id/cancel-request/clear', write, async () => notImplemented());
  // F6F7-STUB(L3): L3-3 → `DealView`.
  fastify.post('/deals/:id/problem', write, async () => notImplemented());
};

export default dealRoutes;
