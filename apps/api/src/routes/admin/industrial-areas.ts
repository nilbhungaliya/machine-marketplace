import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  adoptOtherValue,
  createArea,
  deleteArea,
  listAreas,
  listOtherValues,
  reorderAreas,
  updateArea,
} from '../../services/locations/industrial-area-admin.service.js';

const idParams = z.object({ id: z.string().uuid() });
const name = z.string().trim().min(2).max(80);
const place = z.string().trim().min(1).max(80);

const listQuery = z.object({ city: place.optional(), state: place.optional() });
const createBody = z.object({ name, city: place, state: place }).strict();
const updateBody = z
  .object({ name: name.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
const reorderBody = z.object({ city: place, state: place, ids: z.array(z.string().uuid()).min(1) }).strict();
const adoptBody = z.object({ text: z.string().trim().min(1).max(80), district: place, state: place, name }).strict();

const tags = ['Admin Industrial Areas'];

// Thin controllers (F1 spec §8.3): validate → service → `{ data }`. Category managers (and super admins) only.
const adminIndustrialAreaRoutes: FastifyPluginAsync = async (fastify) => {
  const role = fastify.requireAdminRole('category_manager');

  fastify.get('/admin/industrial-areas', { schema: { tags }, preHandler: role }, async (request) => {
    const query = listQuery.parse(request.query);
    return { data: await listAreas(fastify.db, { ...query, includeInactive: true }) };
  });

  fastify.post('/admin/industrial-areas', { schema: { tags }, preHandler: role }, async (request, reply) => {
    const body = createBody.parse(request.body);
    reply.code(201);
    return { data: await createArea(fastify.db, request.admin!.adminId, body) };
  });

  fastify.patch('/admin/industrial-areas/:id', { schema: { tags }, preHandler: role }, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = updateBody.parse(request.body);
    return { data: await updateArea(fastify.db, request.admin!.adminId, id, patch) };
  });

  fastify.delete('/admin/industrial-areas/:id', { schema: { tags }, preHandler: role }, async (request) => {
    const { id } = idParams.parse(request.params);
    await deleteArea(fastify.db, request.admin!.adminId, id);
    return { data: null };
  });

  fastify.post('/admin/industrial-areas/reorder', { schema: { tags }, preHandler: role }, async (request) => {
    const body = reorderBody.parse(request.body);
    await reorderAreas(fastify.db, request.admin!.adminId, body);
    return { data: null };
  });

  fastify.get('/admin/industrial-areas/other', { schema: { tags }, preHandler: role }, async () => ({
    data: await listOtherValues(fastify.db),
  }));

  fastify.post('/admin/industrial-areas/other/adopt', { schema: { tags }, preHandler: role }, async (request) => {
    const body = adoptBody.parse(request.body);
    return { data: await adoptOtherValue(fastify.db, request.admin!.adminId, body) };
  });
};

export default adminIndustrialAreaRoutes;
