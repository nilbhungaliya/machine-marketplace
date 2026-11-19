import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../../lib/member-guard.js';

// Admin Reports & flags for conversations and reviews (F6 + F7 spec §16.1–§16.2, P9). L1 owns this file (L1-5);
// C0-4b stubs. Roles: moderator, support. The resolve writes `audit_log` (`report.resolve`).

const tags = ['Admin reports'];

const adminReportRoutes: FastifyPluginAsync = async (fastify) => {
  const staff = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator', 'support') };
  // F6F7-STUB(L1): L1-5 `?target=conversation|review&status=` → `AdminReportRow` page.
  fastify.get('/admin/reports', staff, async () => notImplemented());
  // F6F7-STUB(L1): L1-5 `{ outcome: actioned | dismissed, note }`.
  fastify.post('/admin/reports/:id/resolve', staff, async () => notImplemented());
};

export default adminReportRoutes;
