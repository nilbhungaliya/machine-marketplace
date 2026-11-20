import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { reasonBody } from '../../lib/admin-text.js';
import {
  ADMIN_PART_REQUEST_PAGE_SIZES,
  adminRequestPhotos,
  getAdminPartRequest,
  listAdminPartRequests,
  removePartRequest,
  restorePartRequest,
} from '../../services/part-requests/admin.service.js';
import { paged, partRequestListFilters } from './list-filters.js';

// Admin part requests (F8 spec §14; lane A3): list, detail, photos, remove / restore with a reason (audit-logged).
// Moderators and support (super_admin passes every role check). Thin: Zod-parse → service → `{ data }`.

const tags = ['Admin: part requests'];

const listQuery = paged(
  partRequestListFilters,
  z.coerce.number().int().min(1).max(10_000).default(1),
  z.coerce
    .number()
    .refine((n) => (ADMIN_PART_REQUEST_PAGE_SIZES as readonly number[]).includes(n), 'must be 25, 50 or 100')
    .default(25),
);
const params = z.object({ id: z.string().uuid() });

const adminPartRequestRoutes: FastifyPluginAsync = async (fastify) => {
  const staff = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator', 'support') };

  // → `AdminPartRequestList`.
  fastify.get('/admin/part-requests', staff, async (request) => ({
    data: await listAdminPartRequests(fastify.db, listQuery.parse(request.query ?? {})),
  }));

  // → `AdminPartRequestDetail`.
  fastify.get('/admin/part-requests/:id', staff, async (request) => {
    const { id } = params.parse(request.params);
    return { data: await getAdminPartRequest(fastify.db, id) };
  });

  // → `PartRequestPhotos` (300 s URLs).
  fastify.get('/admin/part-requests/:id/photos', staff, async (request) => {
    const { id } = params.parse(request.params);
    return { data: await adminRequestPhotos(fastify.db, id) };
  });

  // → `AdminPartRequestDetail`; audit `part_request.remove`.
  fastify.post('/admin/part-requests/:id/remove', staff, async (request) => {
    const { id } = params.parse(request.params);
    return { data: await removePartRequest(fastify, request.admin!, id, reasonBody.parse(request.body ?? {})) };
  });

  // → `AdminPartRequestDetail`; audit `part_request.restore`.
  fastify.post('/admin/part-requests/:id/restore', staff, async (request) => {
    const { id } = params.parse(request.params);
    return { data: await restorePartRequest(fastify, request.admin!, id, reasonBody.parse(request.body ?? {})) };
  });
};

export default adminPartRequestRoutes;
