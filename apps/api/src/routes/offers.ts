import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DEAL_LIMITS } from '@mpm/shared-types';
import { groupRateLimit } from '../lib/group-limit.js';
import { refuseViewer } from '../lib/member-guard.js';
import { runIdempotent } from '../services/idempotency.service.js';
import { acceptOffer, businessBlockedBody, quantityNotAvailableBody } from '../services/offers/accept.service.js';
import {
  counterOffer,
  offersOptions,
  reconfirmOffer,
  rejectOffer,
  sendOffer,
  sendQuote,
  withdrawOffer,
} from '../services/offers/offer.service.js';

// Offers, buy now, quotes (F6 + F7 spec §7, §12.2). Thin: Zod-parse → service (in the idempotent transaction) →
// `{ data }`. `POST /listings/:id/offers` lives here (P12). Every offer write counts in the `offer` group (20 / min) and
// takes an optional `Idempotency-Key` (P11).

const tags = ['Offers'];

const idParams = z.object({ id: z.string().uuid() });
const price = z.number().int().min(1).max(2_147_483_647);
/** A decimal string with at most 3 decimals ("2", "2.5"); the unit's decimals are the service's check. */
const quantity = z.string().trim().regex(/^\d{1,11}(\.\d{1,3})?$/, 'a quantity like "2" or "2.5"');
const validityHours = z.number().int().min(1).max(720).optional();
const note = z.string().max(DEAL_LIMITS.offerNoteMax).nullish();

const offerBody = z.object({
  kind: z.enum(['offer', 'buy_now']),
  pricePerUnitPaise: price.optional(),
  quantity,
  validityHours,
  note,
});
const termsBody = z.object({ pricePerUnitPaise: price, quantity, validityHours, note });
const rejectBody = z.object({ note: z.string().max(DEAL_LIMITS.rejectNoteMax).nullish() });

const offerRoutes: FastifyPluginAsync = async (fastify) => {
  const write = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('offer', DEAL_LIMITS.offerActionsPerMinute, 60)],
    config: { idempotent: true },
  };

  fastify.post('/listings/:id/offers', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = offerBody.parse(request.body ?? {});
    return runIdempotent(request, reply, fastify, async (tx) => ({
      status: 200,
      body: { data: await sendOffer(tx, request.user!, id, body) },
    }));
  });

  fastify.get('/offers/options', { schema: { tags }, preHandler: [fastify.requireUser] }, async (request) => ({
    data: await offersOptions(fastify.db, request.user!),
  }));

  fastify.post('/threads/:id/quote', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = termsBody.parse(request.body ?? {});
    return runIdempotent(request, reply, fastify, async (tx) => ({
      status: 200,
      body: { data: await sendQuote(tx, request.user!, id, body) },
    }));
  });

  // §7.6: too little stock moves the offer to backup and commits; the 409 is stored for a retried key (P11).
  fastify.post('/offers/:id/accept', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return runIdempotent(request, reply, fastify, async (tx) => {
      const result = await acceptOffer(tx, request.user!, id);
      if (result.outcome === 'backup') return { status: 409, body: quantityNotAvailableBody(result.available) };
      // A blocked pair: the thread's chains closed (committed), 403 stored for a retried key.
      if (result.outcome === 'blocked') return { status: 403, body: businessBlockedBody() };
      return { status: 200, body: { data: { offer: result.offer, dealId: result.dealId } } };
    });
  });

  fastify.post('/offers/:id/counter', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = termsBody.parse(request.body ?? {});
    return runIdempotent(request, reply, fastify, async (tx) => ({
      status: 200,
      body: { data: await counterOffer(tx, request.user!, id, body) },
    }));
  });

  fastify.post('/offers/:id/reject', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = rejectBody.parse(request.body ?? {});
    return runIdempotent(request, reply, fastify, async (tx) => ({
      status: 200,
      body: { data: await rejectOffer(tx, request.user!, id, body) },
    }));
  });

  fastify.post('/offers/:id/withdraw', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return runIdempotent(request, reply, fastify, async (tx) => ({
      status: 200,
      body: { data: await withdrawOffer(tx, request.user!, id) },
    }));
  });

  fastify.post('/offers/:id/reconfirm', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return runIdempotent(request, reply, fastify, async (tx) => ({
      status: 200,
      body: { data: await reconfirmOffer(tx, request.user!, id) },
    }));
  });
};

export default offerRoutes;
