import type { FastifyPluginAsync } from 'fastify';
import { DEAL_LIMITS } from '@mpm/shared-types';
import { groupRateLimit } from '../lib/group-limit.js';
import { notImplemented, refuseViewer } from '../lib/member-guard.js';

// Offers, buy now, quotes (F6 + F7 spec §7, §12.2). L2 owns this file; C0-4b stubs. `POST /listings/:id/offers` lives
// here (P12). Every offer write counts in the `offer` group (20 / min).

const tags = ['Offers'];

const offerRoutes: FastifyPluginAsync = async (fastify) => {
  const write = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('offer', DEAL_LIMITS.offerActionsPerMinute, 60)],
    config: { idempotent: true },
  };

  // F6F7-STUB(L2): L2-1 → `{ threadId, offer }`.
  fastify.post('/listings/:id/offers', write, async () => notImplemented());
  // F6F7-STUB(L2): L2-1 → `OffersOptions`.
  fastify.get('/offers/options', { schema: { tags }, preHandler: [fastify.requireUser] }, async () => notImplemented());
  // F6F7-STUB(L2): L2-1 → `OfferView`.
  fastify.post('/threads/:id/quote', write, async () => notImplemented());
  // F6F7-STUB(L2): L2-3 → `{ offer, dealId }`.
  fastify.post('/offers/:id/accept', write, async () => notImplemented());
  // F6F7-STUB(L2): L2-2 → `OfferView` (new row).
  fastify.post('/offers/:id/counter', write, async () => notImplemented());
  // F6F7-STUB(L2): L2-2 → `OfferView`.
  fastify.post('/offers/:id/reject', write, async () => notImplemented());
  fastify.post('/offers/:id/withdraw', write, async () => notImplemented());
  // F6F7-STUB(L2): L2-4 → `OfferView`.
  fastify.post('/offers/:id/reconfirm', write, async () => notImplemented());
};

export default offerRoutes;
