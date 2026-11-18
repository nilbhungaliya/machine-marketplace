import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { TEMPLATE_KINDS } from '@mpm/shared-types';
import { listBrands, listModels } from '../services/catalog/brand-read.service.js';
import { getCategoryTree, getMasterData, loadTemplate } from '../services/catalog/read.service.js';

const idParams = z.object({ id: z.string().uuid() });
const templateQuery = z.object({ kind: z.enum(TEMPLATE_KINDS) });
const brandsQuery = z.object({ machineTypeId: z.string().uuid().optional(), role: z.enum(['machines', 'parts']).optional() });
const modelsQuery = z.object({ brandId: z.string().uuid().optional(), machineTypeId: z.string().uuid().optional() });

// Public catalogue reads: no login (guests browse). Thin: validate → service → `{ data }`.
const catalogRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/categories', { schema: { tags: ['Catalogue'] } }, async () => ({
    data: await getCategoryTree(fastify.db, { includeInactive: false }),
  }));

  fastify.get('/categories/:id/template', { schema: { tags: ['Catalogue'] } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { kind } = templateQuery.parse(request.query);
    return { data: await loadTemplate(fastify.db, id, kind, { includeRetired: false }) };
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
