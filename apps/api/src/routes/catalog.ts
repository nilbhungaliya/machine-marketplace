import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { TEMPLATE_KINDS } from '@mpm/shared-types';
import { listBrands, listModels } from '../services/catalog/brand-read.service.js';
import { getCategoryTree, getMasterData, loadTemplate } from '../services/catalog/read.service.js';

const idParams = z.object({ id: z.string().uuid() });
// `includeRetired=1` (F2 spec §8.1): the listing page labels a listing's retired spec values, so it reads the template
// with retired fields and options (each `status: 'retired'`), also under a node deactivated since. The sell wizard uses
// the default (active only).
const templateQuery = z.object({
  kind: z.enum(TEMPLATE_KINDS),
  includeRetired: z
    .enum(['1', 'true', '0', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});
const brandsQuery = z.object({ machineTypeId: z.string().uuid().optional(), role: z.enum(['machines', 'parts']).optional() });
const modelsQuery = z.object({ brandId: z.string().uuid().optional(), machineTypeId: z.string().uuid().optional() });

// Public catalogue reads: no login (guests browse). Thin: validate → service → `{ data }`.
const catalogRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/categories', { schema: { tags: ['Catalogue'] } }, async () => ({
    data: await getCategoryTree(fastify.db, { includeInactive: false }),
  }));

  fastify.get('/categories/:id/template', { schema: { tags: ['Catalogue'] } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { kind, includeRetired } = templateQuery.parse(request.query);
    return { data: await loadTemplate(fastify.db, id, kind, { includeRetired }) };
  });

  fastify.get('/brands', { schema: { tags: ['Catalogue'] } }, async (request) => {
    const query = brandsQuery.parse(request.query);
    return { data: await listBrands(fastify.db, { includeInactive: false, ...query }) };
  });

  fastify.get('/models', { schema: { tags: ['Catalogue'] } }, async (request) => {
    const query = modelsQuery.parse(request.query);
    return { data: await listModels(fastify.db, { includeInactive: false, ...query }) };
  });

  fastify.get('/master-data', { schema: { tags: ['Catalogue'] } }, async () => ({
    data: await getMasterData(fastify.db, { includeInactive: false }),
  }));
};

export default catalogRoutes;
