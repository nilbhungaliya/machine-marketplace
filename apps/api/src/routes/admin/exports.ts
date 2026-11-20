import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EXPORT_SHEETS, EXPORT_SHEET_ROLES } from '@mpm/shared-types';
import { AppError, ForbiddenError } from '../../lib/errors.js';
import { adminRateLimit } from '../../lib/group-limit.js';

// AD6 exports (admin close-out §10, R12; lane A4): `GET /admin/exports/:sheet?<the list's filters>&includeContacts=1`
// → a streamed CSV through `runCsvExport` (`services/exports/run-export.ts`). You can export what you can list: the
// sheet's roles are `EXPORT_SHEET_ROLES` (super_admin passes every check). 10 exports per 10 min per admin, shared
// with the audit log export.

const tags = ['Admin exports'];
const params = z.object({ sheet: z.enum(EXPORT_SHEETS) });

/** Before the rate limit, so an unknown sheet (400) or a role outside the sheet's list (403) spends no export. */
async function sheetGuard(request: FastifyRequest): Promise<void> {
  const { sheet } = params.parse(request.params);
  const role = request.admin!.role;
  if (role !== 'super_admin' && !EXPORT_SHEET_ROLES[sheet].includes(role)) throw new ForbiddenError();
}

const adminExportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/admin/exports/:sheet',
    { schema: { tags }, preHandler: [fastify.requireAdmin, sheetGuard, adminRateLimit('admin_export', 10, 600)] },
    async () => {
      // AC-STUB(A4): the five sheets (`services/exports/*.ts`) answer 501 until lane A4 builds them.
      throw new AppError('Not implemented yet', 501, 'NOT_IMPLEMENTED');
    },
  );
};

export default adminExportRoutes;
