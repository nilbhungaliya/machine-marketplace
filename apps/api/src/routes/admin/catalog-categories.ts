import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CATEGORY_ICONS } from '@mpm/shared-types';
import { getCategoryTree } from '../../services/catalog/read.service.js';
import {
  createCategory,
  deleteCategory,
  getAdminCategoryDetail,
  moveCategory,
  reorderSiblings,
  updateCategory,
} from '../../services/catalog/category-admin.service.js';

const idParams = z.object({ id: z.string().uuid() });
const name = z.string().trim().min(1).max(120);
const slug = z.string().max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits and single hyphens');
const icon = z.enum(CATEGORY_ICONS);
const sideConvention = z.string().max(300).nullable();
const hasSides = z.boolean().nullable();

const createBody = z
  .object({
    parentId: z.string().uuid().nullable(),
    name,
    slug: slug.optional(),
    icon: icon.optional(),
    hasSides: hasSides.optional(),
    sideConvention: sideConvention.optional(),
  })
  .strict();

const updateBody = z
  .object({
    name: name.optional(),
    slug: slug.optional(),
    icon: icon.nullable().optional(),
    isActive: z.boolean().optional(),
    hasSides: hasSides.optional(),
    sideConvention: sideConvention.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');

const moveBody = z.object({ parentId: z.string().uuid() }).strict();
const reorderBody = z.object({ parentId: z.string().uuid().nullable(), orderedIds: z.array(z.string().uuid()).min(1) }).strict();

const tags = ['Admin Catalogue'];

// Thin controllers: validate, call the service, return `{ data }`. Tree rules live in category-admin.service.
const adminCatalogCategoryRoutes: FastifyPluginAsync = async (fastify) => {
  const write = fastify.requireAdminRole('category_manager');

  fastify.get('/admin/categories', { schema: { tags }, preHandler: fastify.requireAdmin }, async () => ({
    data: await getCategoryTree(fastify.db, { includeInactive: true }),
  }));

  fastify.get('/admin/categories/:id', { schema: { tags }, preHandler: fastify.requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await getAdminCategoryDetail(fastify.db, id) };
  });

  fastify.post('/admin/categories', { schema: { tags }, preHandler: write }, async (request, reply) => {
    const body = createBody.parse(request.body);
    reply.code(201);
    return { data: await createCategory(fastify.db, request.admin!.adminId, body, fastify.redis) };
  });

  fastify.patch('/admin/categories/:id', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = updateBody.parse(request.body);
    return { data: await updateCategory(fastify.db, request.admin!.adminId, id, patch, fastify.redis) };
  });

  fastify.post('/admin/categories/:id/move', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { parentId } = moveBody.parse(request.body);
    return { data: await moveCategory(fastify.db, request.admin!.adminId, id, parentId, fastify.redis) };
  });

  fastify.post('/admin/categories/reorder', { schema: { tags }, preHandler: write }, async (request) => {
    const { parentId, orderedIds } = reorderBody.parse(request.body);
    await reorderSiblings(fastify.db, request.admin!.adminId, parentId, orderedIds, fastify.redis);
    return { data: null };
  });

  fastify.delete('/admin/categories/:id', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    await deleteCategory(fastify.db, request.admin!.adminId, id, fastify.redis);
    return { data: null };
  });
};

export default adminCatalogCategoryRoutes;
