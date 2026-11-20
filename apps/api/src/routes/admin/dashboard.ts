import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../lib/errors.js';

// AD1 dashboard (admin close-out §6.3; lane A1): any admin; reads, no audit row.
//   GET /admin/dashboard?range&from&to&city&industrialAreaId&categoryId&breakdown → AdminDashboard (cached 60 s)
//   GET /admin/dashboard/work → AdminWorkCounts for the caller's role
//   GET /admin/dashboard/options → DashboardOptions

const tags = ['Admin dashboard'];
// AC-STUB(A1): every handler below answers 501 until lane A1 builds it.
const notImplemented = (): never => {
  throw new AppError('Not implemented yet', 501, 'NOT_IMPLEMENTED');
};

const adminDashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const anyAdmin = { schema: { tags }, preHandler: fastify.requireAdmin };
  fastify.get('/admin/dashboard', anyAdmin, async () => notImplemented());
  fastify.get('/admin/dashboard/work', anyAdmin, async () => notImplemented());
  fastify.get('/admin/dashboard/options', anyAdmin, async () => notImplemented());
};

export default adminDashboardRoutes;
