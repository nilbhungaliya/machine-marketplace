import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CATALOG_KEY_REGEX } from '@mpm/shared-types';
import { getMasterData } from '../../services/catalog/read.service.js';
import {
  createCondition,
  createUnit,
  reorderConditions,
  reorderUnits,
  updateCondition,
  updateUnit,
  type UnitDecimals,
} from '../../services/catalog/master-admin.service.js';

const idParams = z.object({ id: z.string().uuid() });
const key = z.string().regex(CATALOG_KEY_REGEX, 'snake_case: a letter, then 1–39 of a-z, 0-9, _');
const label = z.string().trim().min(1).max(120);
const decimals = z
  .number()
  .int()
  .min(0)
  .max(3)
  .transform((n) => n as UnitDecimals);
/** Trimmed; blank (or null) is stored as null. */
const description = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((s) => (s === '' ? null : s));

const nonEmpty = (patch: object) => Object.keys(patch).length > 0;

const createUnitBody = z.object({ key, label, decimals: decimals.default(0) }).strict();
// No `key` on updates: keys are fixed once created (.strict() rejects them).
const updateUnitBody = z
  .object({
    label: label.optional(),
    decimals: decimals.optional(),
    isActive: z.boolean().optional(),
    isMachineUnit: z.boolean().optional(),
  })
  .strict()
  .refine(nonEmpty, 'Nothing to update');

const createConditionBody = z.object({ key, label, description: description.optional() }).strict();
const updateConditionBody = z
  .object({ label: label.optional(), description: description.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine(nonEmpty, 'Nothing to update');

const reorderBody = z.object({ orderedIds: z.array(z.string().uuid()).min(1) }).strict();

const tags = ['Admin Catalogue'];

// Thin controllers: validate → service → `{ data }`. Master-data rules live in master-admin.service.
const adminCatalogMasterRoutes: FastifyPluginAsync = async (fastify) => {
  const write = fastify.requireAdminRole('category_manager');

  fastify.get('/admin/master-data', { schema: { tags }, preHandler: fastify.requireAdmin }, async () => ({
    data: await getMasterData(fastify.db, { includeInactive: true }),
  }));

  // Units
  fastify.post('/admin/master-data/units', { schema: { tags }, preHandler: write }, async (request, reply) => {
    const body = createUnitBody.parse(request.body);
    reply.code(201);
    return { data: await createUnit(fastify.db, request.admin!.adminId, body) };
  });

  fastify.patch('/admin/master-data/units/:id', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = updateUnitBody.parse(request.body);
    return { data: await updateUnit(fastify.db, request.admin!.adminId, id, patch) };
  });

  fastify.post('/admin/master-data/units/reorder', { schema: { tags }, preHandler: write }, async (request) => {
    const { orderedIds } = reorderBody.parse(request.body);
    await reorderUnits(fastify.db, request.admin!.adminId, orderedIds);
    return { data: null };
  });

  // Conditions
  fastify.post('/admin/master-data/conditions', { schema: { tags }, preHandler: write }, async (request, reply) => {
    const body = createConditionBody.parse(request.body);
    reply.code(201);
    return { data: await createCondition(fastify.db, request.admin!.adminId, body) };
  });

  fastify.patch('/admin/master-data/conditions/:id', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = updateConditionBody.parse(request.body);
    return { data: await updateCondition(fastify.db, request.admin!.adminId, id, patch) };
  });

  fastify.post('/admin/master-data/conditions/reorder', { schema: { tags }, preHandler: write }, async (request) => {
    const { orderedIds } = reorderBody.parse(request.body);
    await reorderConditions(fastify.db, request.admin!.adminId, orderedIds);
    return { data: null };
  });
};

export default adminCatalogMasterRoutes;
