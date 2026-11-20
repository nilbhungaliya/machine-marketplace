import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ADMIN_REASON_MAX, ADMIN_REASON_MIN, RENTAL_BOOKING_STATUSES } from '@mpm/shared-types';
import { isStorableText } from '../../lib/spec-check.js';
import { adminCancelBooking, getAdminRentalBooking, listAdminRentalBookings } from '../../services/rentals/admin.service.js';

// M14 admin rental bookings (spec §15, §13.2, R15; plan A3-4). Roles `operations` and `support`; the cancel writes
// `audit_log` (`rental_booking.cancel`) in its transaction (`runTx` in the service: emits after commit).

const tags = ['Admin rentals'];

const idParams = z.object({ id: z.string().uuid() });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date YYYY-MM-DD');
const listQuery = z
  .object({
    status: z.enum(RENTAL_BOOKING_STATUSES).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    businessId: z.string().uuid().optional(),
    listingId: z.string().uuid().optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().pipe(z.union([z.literal(25), z.literal(50), z.literal(100)])).default(25),
  })
  .strict();
const cancelBody = z
  .object({
    reason: z
      .string()
      .trim()
      .min(ADMIN_REASON_MIN)
      .max(ADMIN_REASON_MAX)
      .refine((s) => isStorableText(s), 'contains characters that cannot be saved'),
  })
  .strict();

const adminRentalRoutes: FastifyPluginAsync = async (fastify) => {
  const staff = { schema: { tags }, preHandler: fastify.requireAdminRole('operations', 'support') };

  fastify.get('/admin/rental-bookings', staff, async (request) => {
    const q = listQuery.parse(request.query);
    return { data: await listAdminRentalBookings(fastify.db, q) };
  });

  fastify.get('/admin/rental-bookings/:id', staff, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    // The site address is in it (§18): never cached.
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await getAdminRentalBooking(fastify.db, id) };
  });

  fastify.post('/admin/rental-bookings/:id/cancel', staff, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { reason } = cancelBody.parse(request.body ?? {});
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await adminCancelBooking(fastify, request.admin!, id, { reason }) };
  });
};

export default adminRentalRoutes;
