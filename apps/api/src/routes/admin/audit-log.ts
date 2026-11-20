import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AUDIT_PAGE_SIZES } from '@mpm/shared-types';
import { adminRateLimit } from '../../lib/group-limit.js';
import { isRealDate } from '../../lib/spec-check.js';
import {
  auditExportSpec,
  auditFacets,
  getAuditEntry,
  listAuditLog,
  revealAuditEntry,
} from '../../services/admin-insights/audit-log.js';
import { runCsvExport } from '../../services/exports/run-export.js';

// AD7 audit log viewer (admin close-out §11.2–§11.3, R16; lane A2): super_admin only, read-only (no route edits or
// deletes a row). Reads write no audit row except the reveal (`audit.reveal`) and the export (`export.create`).
//   GET /admin/audit-log?from&to&adminId&actor&action&entityType&entityId&q&page&pageSize → AuditLogPage
//   GET /admin/audit-log/facets → AuditLogFacets
//   GET /admin/audit-log/export?<filters> → CSV, no snapshots (cap and audit as R12; shares `admin_export` with the sheets)
//   GET /admin/audit-log/:id → AuditLogDetail (masked)
//   POST /admin/audit-log/:id/reveal → AuditLogDetail (unmasked; 30 / hour per admin)

const tags = ['Admin audit log'];

/** A real calendar date: `2026-02-30` is a 400, not a failed cast. */
const day = z.string().refine(isRealDate, 'A real date, YYYY-MM-DD');

const filterFields = {
  from: day.optional(),
  to: day.optional(),
  adminId: z.string().uuid().optional(),
  actor: z.literal('system').optional(),
  action: z.string().trim().min(1).max(80).optional(),
  entityType: z.string().trim().min(1).max(60).optional(),
  entityId: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(100).optional(),
};

const filterQuery = z.object(filterFields).strict();
const listQuery = z
  .object({
    ...filterFields,
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((n) => (AUDIT_PAGE_SIZES as readonly number[]).includes(n), 'Page size 25, 50 or 100')
      .default(25),
  })
  .strict();
const params = z.object({ id: z.string().uuid() });

const adminAuditLogRoutes: FastifyPluginAsync = async (fastify) => {
  const superAdmin = fastify.requireAdminRole();

  fastify.get('/admin/audit-log', { schema: { tags }, preHandler: superAdmin }, async (request) => ({
    data: await listAuditLog(fastify.db, listQuery.parse(request.query)),
  }));

  fastify.get('/admin/audit-log/facets', { schema: { tags }, preHandler: superAdmin }, async () => ({
    data: await auditFacets(fastify.db),
  }));

  fastify.get(
    '/admin/audit-log/export',
    { schema: { tags }, preHandler: [superAdmin, adminRateLimit('admin_export', 10, 600)] },
    async (request, reply) => {
      const filters = filterQuery.parse(request.query);
      await runCsvExport(fastify, reply, auditExportSpec(fastify.db, request.admin!.adminId, filters));
      return reply;
    },
  );

  fastify.get('/admin/audit-log/:id', { schema: { tags }, preHandler: superAdmin }, async (request) => ({
    data: await getAuditEntry(fastify.db, params.parse(request.params).id),
  }));

  fastify.post(
    '/admin/audit-log/:id/reveal',
    { schema: { tags }, preHandler: [superAdmin, adminRateLimit('admin_reveal', 30, 3600)] },
    async (request) => ({
      data: await revealAuditEntry(fastify, request.admin!.adminId, params.parse(request.params).id),
    }),
  );
};

export default adminAuditLogRoutes;
