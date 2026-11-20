import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { groupRateLimit } from '../lib/group-limit.js';
import { refuseViewer } from '../lib/member-guard.js';
import { perUser } from '../lib/per-user-limit.js';

// M14 rental bookings (spec §13.2; plan D2, D6). Lane A1 owns this file: the estimate, the request and every
// `/rental-bookings/*` route except the review (in `reviews.ts`, A3) and the calendar / blocks (`rental-calendar.ts`,
// A2). Every write takes an `Idempotency-Key` (`config.idempotent`), refuses a viewer (`403 VIEWER_READ_ONLY`) and
// counts in its rate group: `rental_booking` (request, change: 20 / 10 min), `rental_booking_action` (every other
// booking write: 60 / 10 min). Registered in C0-4 with 501 stubs.

const tags = ['Rentals'];

/** M14-STUB(A1): the route isn't built yet. */
const notImplemented = (reply: FastifyReply) =>
  reply.code(501).send({ error: 'Not implemented yet', code: 'NOT_IMPLEMENTED' });

const rentalRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  const proposal = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('rental_booking', 20, 600)],
    config: { idempotent: true },
  };
  const action = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('rental_booking_action', 60, 600)],
    config: { idempotent: true },
  };

  // Public (guests by `X-Install-Id`): 60 a minute per user, plus the discovery per-IP cap (A1-1).
  fastify.post('/rentals/estimate', { schema: { tags }, preHandler: [fastify.optionalUser], config: perUser(60, '1 minute') }, async (_req, reply) =>
    notImplemented(reply),
  );

  fastify.post('/listings/:id/bookings', proposal, async (_req, reply) => notImplemented(reply));
  fastify.get('/rental-bookings', read, async (_req, reply) => notImplemented(reply));
  fastify.get('/rental-bookings/:id', read, async (_req, reply) => notImplemented(reply));
  fastify.post('/rental-bookings/:id/change', proposal, async (_req, reply) => notImplemented(reply));
  for (const step of ['confirm', 'decline', 'accept', 'withdraw', 'on-site', 'returned', 'confirm-return', 'cancel', 'problem']) {
    fastify.post(`/rental-bookings/:id/${step}`, action, async (_req, reply) => notImplemented(reply));
  }
  fastify.get('/rental-bookings/:id/photos', read, async (_req, reply) => notImplemented(reply));
  fastify.post(
    '/rental-bookings/:id/photos/presign',
    { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer], config: perUser(30) },
    async (_req, reply) => notImplemented(reply),
  );
  fastify.patch('/rental-bookings/:id/notes', action, async (_req, reply) => notImplemented(reply));
};

export default rentalRoutes;
