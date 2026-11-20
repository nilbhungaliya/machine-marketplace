import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { REPORT_STATUSES } from '@mpm/shared-types';
import { runTx } from '../../lib/tx-effects.js';
import {
  ADMIN_REPORT_TARGETS,
  adminReportCounts,
  listAdminReports,
  resolveAdminReport,
} from '../../services/reports/admin-reports.service.js';

// Admin Reports & flags for businesses, listings (read-only), conversations, reviews and part requests (F6 + F7 spec
// §16.1–§16.2, P9; F8 §14; admin close-out §7.2). Roles: moderator, support. The resolve writes `audit_log`
// (`report.resolve`); a listing report answers `409 REPORT_RESOLVE_ELSEWHERE`.

const tags = ['Admin reports'];
const listQuery = z.object({
  target: z.enum(ADMIN_REPORT_TARGETS).optional(),
  status: z.enum(REPORT_STATUSES).optional(),
  cursor: z.string().max(300).optional(),
});
const params = z.object({ id: z.string().uuid() });
const resolveBody = z.object({ outcome: z.enum(['actioned', 'dismissed']), note: z.string().max(2000) }).strict();

const adminReportRoutes: FastifyPluginAsync = async (fastify) => {
  const staff = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator', 'support') };
  // → `{ items: AdminReportRow[], nextCursor }`.
  fastify.get('/admin/reports', staff, async (request) => {
    return { data: await listAdminReports(fastify.db, listQuery.parse(request.query ?? {})) };
  });
  // → `AdminReportCounts` (admin close-out plan D5): the Reports & flags nav badge shows their sum.
  fastify.get('/admin/reports/count', staff, async () => ({ data: await adminReportCounts(fastify.db) }));
  // → `AdminReportRow`.
  fastify.post('/admin/reports/:id/resolve', staff, async (request) => {
    const { id } = params.parse(request.params);
    const body = resolveBody.parse(request.body);
    return { data: await runTx(fastify, (tx) => resolveAdminReport(tx, request.admin!.adminId, id, body)) };
  });
};

export default adminReportRoutes;
