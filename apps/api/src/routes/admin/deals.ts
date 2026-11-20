import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getAdminDeal, listAdminDeals } from '../../services/deals/deal-admin.service.js';
import { dealListFilters, paged } from './list-filters.js';

// Admin Deals (F6 + F7 spec §16.1–§16.2): read-only. L3 owns this file (L3-3). Roles: support, operations.

const tags = ['Admin deals'];

const idParams = z.object({ id: z.string().uuid() });
const listQuery = paged(
  dealListFilters,
  z.coerce.number().int().min(1).default(1),
  z.coerce.number().int().min(1).max(100).default(25),
);

const adminDealRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: fastify.requireAdminRole('support', 'operations') };

  fastify.get('/admin/deals', read, async (request) => {
    const q = listQuery.parse(request.query);
    return { data: await listAdminDeals(fastify.db, q) };
  });

  fastify.get('/admin/deals/:id', read, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await getAdminDeal(fastify.db, id) };
  });
};

export default adminDealRoutes;
