import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DEAL_STATUSES } from '@mpm/shared-types';
import { isRealDate } from '../../lib/spec-check.js';
import { getAdminDeal, listAdminDeals } from '../../services/deals/deal-admin.service.js';

// Admin Deals (F6 + F7 spec §16.1–§16.2): read-only. L3 owns this file (L3-3). Roles: support, operations.

const tags = ['Admin deals'];

const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  status: z.enum(DEAL_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  from: z.string().refine(isRealDate, 'must be a date (YYYY-MM-DD)').optional(),
  to: z.string().refine(isRealDate, 'must be a date (YYYY-MM-DD)').optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

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
