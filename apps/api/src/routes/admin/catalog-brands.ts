import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CATALOG_KEY_REGEX } from '@mpm/shared-types';
import { listBrandsWithModels } from '../../services/catalog/brand-read.service.js';
import {
  createBrand,
  createModel,
  deleteBrand,
  deleteModel,
  moveModel,
  reorderBrands,
  reorderModels,
  updateBrand,
  updateModel,
} from '../../services/catalog/brand-admin.service.js';

const idParams = z.object({ id: z.string().uuid() });
const key = z.string().regex(CATALOG_KEY_REGEX, 'snake_case: a letter, then 1–39 of a-z, 0-9, _');
const name = z.string().trim().min(1).max(120);
const slug = z.string().max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits and single hyphens');

const nonEmpty = (patch: object) => Object.keys(patch).length > 0;

const createBrandBody = z
  .object({ key, name, slug: slug.optional(), makesMachines: z.boolean(), makesParts: z.boolean() })
  .strict();
// No `key` on updates: keys are fixed once created (.strict() rejects them).
const updateBrandBody = z
  .object({
    name: name.optional(),
    slug: slug.optional(),
    makesMachines: z.boolean().optional(),
    makesParts: z.boolean().optional(),
    needsReview: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(nonEmpty, 'Nothing to update');

const createModelBody = z.object({ brandId: z.string().uuid(), machineTypeId: z.string().uuid(), key, name }).strict();
const updateModelBody = z
  .object({ name: name.optional(), needsReview: z.boolean().optional(), isActive: z.boolean().optional() })
  .strict()
  .refine(nonEmpty, 'Nothing to update');
const moveModelBody = z
  .object({ brandId: z.string().uuid().optional(), machineTypeId: z.string().uuid().optional() })
  .strict()
  .refine(nonEmpty, 'Give a brand, a machine type or both');

const reorderBody = z.object({ orderedIds: z.array(z.string().uuid()).min(1) }).strict();

const tags = ['Admin Catalogue'];

// Thin controllers: validate → service → `{ data }`. Brand and model rules live in brand-admin.service.
const adminCatalogBrandRoutes: FastifyPluginAsync = async (fastify) => {
  const write = fastify.requireAdminRole('category_manager');

  fastify.get('/admin/brands', { schema: { tags }, preHandler: fastify.requireAdmin }, async () => ({
    data: await listBrandsWithModels(fastify.db),
  }));

  // Brands
  fastify.post('/admin/brands', { schema: { tags }, preHandler: write }, async (request, reply) => {
    const body = createBrandBody.parse(request.body);
    reply.code(201);
    return { data: await createBrand(fastify.db, request.admin!.adminId, body) };
  });

  fastify.patch('/admin/brands/:id', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = updateBrandBody.parse(request.body);
    return { data: await updateBrand(fastify.db, request.admin!.adminId, id, patch) };
  });

  fastify.post('/admin/brands/reorder', { schema: { tags }, preHandler: write }, async (request) => {
    const { orderedIds } = reorderBody.parse(request.body);
    await reorderBrands(fastify.db, request.admin!.adminId, orderedIds);
    return { data: null };
  });

  fastify.delete('/admin/brands/:id', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    await deleteBrand(fastify.db, request.admin!.adminId, id);
    return { data: null };
  });

  // Models
  fastify.post('/admin/models', { schema: { tags }, preHandler: write }, async (request, reply) => {
    const body = createModelBody.parse(request.body);
    reply.code(201);
    return { data: await createModel(fastify.db, request.admin!.adminId, body) };
  });

  fastify.patch('/admin/models/:id', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = updateModelBody.parse(request.body);
    return { data: await updateModel(fastify.db, request.admin!.adminId, id, patch) };
  });

  fastify.post('/admin/models/:id/move', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = moveModelBody.parse(request.body);
    return { data: await moveModel(fastify.db, request.admin!.adminId, id, body) };
  });

  fastify.post('/admin/brands/:id/models/reorder', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { orderedIds } = reorderBody.parse(request.body);
    await reorderModels(fastify.db, request.admin!.adminId, id, orderedIds);
    return { data: null };
  });

  fastify.delete('/admin/models/:id', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    await deleteModel(fastify.db, request.admin!.adminId, id);
    return { data: null };
  });
};

export default adminCatalogBrandRoutes;
