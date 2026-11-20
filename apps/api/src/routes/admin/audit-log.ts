import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { adminRateLimit } from '../../lib/group-limit.js';

// AD7 audit log viewer (admin close-out §11.2–§11.3; lane A2): super_admin only. Reads write no audit row except the
// reveal (`audit.reveal`) and the export (`export.create`).
//   GET /admin/audit-log?from&to&adminId&actor&action&entityType&entityId&q&page&pageSize → AuditLogPage
//   GET /admin/audit-log/facets → AuditLogFacets
//   GET /admin/audit-log/export?<filters> → CSV (cap and audit as R12; shares `admin_export` with the sheets)
//   GET /admin/audit-log/:id → AuditLogDetail (masked)
//   POST /admin/audit-log/:id/reveal → AuditLogDetail (unmasked; 30 / hour per admin)

const tags = ['Admin audit log'];
// AC-STUB(A2): every handler below answers 501 until lane A2 builds it.
const notImplemented = (): never => {
  throw new AppError('Not implemented yet', 501, 'NOT_IMPLEMENTED');
};

const adminAuditLogRoutes: FastifyPluginAsync = async (fastify) => {
  const superAdmin = fastify.requireAdminRole();
  fastify.get('/admin/audit-log', { schema: { tags }, preHandler: superAdmin }, async () => notImplemented());
  fastify.get('/admin/audit-log/facets', { schema: { tags }, preHandler: superAdmin }, async () => notImplemented());
  fastify.get(
    '/admin/audit-log/export',
    { schema: { tags }, preHandler: [superAdmin, adminRateLimit('admin_export', 10, 600)] },
    async () => notImplemented(),
  );
  fastify.get('/admin/audit-log/:id', { schema: { tags }, preHandler: superAdmin }, async () => notImplemented());
  fastify.post(
    '/admin/audit-log/:id/reveal',
    { schema: { tags }, preHandler: [superAdmin, adminRateLimit('admin_reveal', 30, 3600)] },
    async () => notImplemented(),
  );
};

export default adminAuditLogRoutes;
