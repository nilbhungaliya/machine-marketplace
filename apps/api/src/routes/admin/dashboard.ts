import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DASHBOARD_BREAKDOWNS, DASHBOARD_RANGES } from '@mpm/shared-types';
import { getAdminDashboard } from '../../services/admin-insights/dashboard.js';
import { dashboardOptions } from '../../services/admin-insights/options.js';
import { workCounts } from '../../services/admin-insights/work.js';

// AD1 dashboard (admin close-out §6.3, R1, R4; plan A1-2, D6): any admin; reads, no audit row.
//   GET /admin/dashboard?range&from&to&city&industrialAreaId&categoryId&breakdown → AdminDashboard (cached 60 s)
//   GET /admin/dashboard/work → AdminWorkCounts for the caller's role (live, not cached)
//   GET /admin/dashboard/options → DashboardOptions

const tags = ['Admin dashboard'];

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const dashboardQuery = z
  .object({
    range: z.enum(DASHBOARD_RANGES).default('7d'),
    // Checked by the service (`400 DASHBOARD_RANGE_INVALID`), so a malformed custom date gets the range code too.
    from: z.preprocess(emptyToUndefined, z.string().max(10).optional()),
    to: z.preprocess(emptyToUndefined, z.string().max(10).optional()),
    city: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
    industrialAreaId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    categoryId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    breakdown: z.enum(DASHBOARD_BREAKDOWNS).default('city'),
  })
  .strict();

const adminDashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const anyAdmin = { schema: { tags }, preHandler: fastify.requireAdmin };

  fastify.get('/admin/dashboard', anyAdmin, async (request, reply) => {
    const q = dashboardQuery.parse(request.query);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await getAdminDashboard({ db: fastify.db, redis: fastify.redis, log: request.log }, q) };
  });

  fastify.get('/admin/dashboard/work', anyAdmin, async (request, reply) => {
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await workCounts(fastify.db, request.admin!.role) };
  });

  fastify.get('/admin/dashboard/options', anyAdmin, async (_request, reply) => {
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await dashboardOptions(fastify.db) };
  });
};

export default adminDashboardRoutes;
