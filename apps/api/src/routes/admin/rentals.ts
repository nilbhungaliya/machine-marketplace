import type { FastifyPluginAsync, FastifyReply } from 'fastify';

// M14 admin rental bookings (spec §15, §13.2; plan D2). Lane A3 owns this file. Roles `operations` and `support`; the
// cancel writes `audit_log` (`rental_booking.cancel`) in its transaction. Registered in C0-4 with 501 stubs.

const tags = ['Admin rentals'];

/** M14-STUB(A3): the route isn't built yet. */
const notImplemented = (reply: FastifyReply) =>
  reply.code(501).send({ error: 'Not implemented yet', code: 'NOT_IMPLEMENTED' });

const adminRentalRoutes: FastifyPluginAsync = async (fastify) => {
  const staff = { schema: { tags }, preHandler: fastify.requireAdminRole('operations', 'support') };

  fastify.get('/admin/rental-bookings', staff, async (_req, reply) => notImplemented(reply));
  fastify.get('/admin/rental-bookings/:id', staff, async (_req, reply) => notImplemented(reply));
  fastify.post('/admin/rental-bookings/:id/cancel', staff, async (_req, reply) => notImplemented(reply));
};

export default adminRentalRoutes;
