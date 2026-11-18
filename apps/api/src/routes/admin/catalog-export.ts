import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { EXPORT_SHEETS, exportSheet } from '../../services/catalog/export.service.js';

const params = z.object({ sheet: z.enum(EXPORT_SHEETS) });

// A file download, so the body is the CSV itself rather than `{ data }`.
const adminCatalogExportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/admin/catalog/export/:sheet',
    { schema: { tags: ['Admin Catalogue'] }, preHandler: fastify.requireAdmin },
    async (request, reply) => {
      const { sheet } = params.parse(request.params);
      const csv = await exportSheet(fastify.db, sheet);
      const date = new Date().toISOString().slice(0, 10);
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="catalogue-${sheet}-${date}.csv"`)
        .send(csv);
    },
  );
};

export default adminCatalogExportRoutes;
