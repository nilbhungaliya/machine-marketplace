import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { groupRateLimit } from '../lib/group-limit.js';
import { refuseViewer } from '../lib/member-guard.js';

// M14 rental calendar (spec §7.3, §10, §13.2; plan D2). Lane A2 owns this file: the public availability strip, the
// owner's calendar and the owner's blocks. Block writes count in `rental_booking_action` (D6). Registered in C0-4 with
// 501 stubs.

const tags = ['Rentals'];

/** M14-STUB(A2): the route isn't built yet. */
const notImplemented = (reply: FastifyReply) =>
  reply.code(501).send({ error: 'Not implemented yet', code: 'NOT_IMPLEMENTED' });

const rentalCalendarRoutes: FastifyPluginAsync = async (fastify) => {
  const write = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('rental_booking_action', 60, 600)],
  };

  // Public; A2-1 adds the discovery limiter.
  fastify.get('/listings/:id/availability', { schema: { tags }, preHandler: [fastify.optionalUser] }, async (_req, reply) =>
    notImplemented(reply),
  );
  // Owner members (viewers read).
  fastify.get('/listings/:id/calendar', { schema: { tags }, preHandler: [fastify.requireUser] }, async (_req, reply) =>
    notImplemented(reply),
  );
  fastify.post('/listings/:id/rental-blocks', write, async (_req, reply) => notImplemented(reply));
  fastify.patch('/rental-blocks/:id', write, async (_req, reply) => notImplemented(reply));
  fastify.delete('/rental-blocks/:id', write, async (_req, reply) => notImplemented(reply));
};

export default rentalCalendarRoutes;
