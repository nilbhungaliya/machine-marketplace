import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CATALOG_KEY_REGEX, CATALOG_STATUSES, FIELD_APPLIES_TO, FIELD_TYPES, MAX_HIGHLIGHT_RANK } from '@mpm/shared-types';
import {
  createField,
  createOption,
  reorderFields,
  reorderOptions,
  updateField,
  updateOption,
} from '../../services/catalog/field-admin.service.js';

const idParams = z.object({ id: z.string().uuid() });
const key = z.string().regex(CATALOG_KEY_REGEX, 'snake_case: a letter, then 1–39 of a-z, 0-9, _');
const label = z.string().trim().min(1).max(120);
/** Trimmed; blank (or null) is stored as null. */
const helpText = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((s) => (s === '' ? null : s));
const unit = z.string().trim().min(1).max(20);
// numeric(14,3) columns
const bound = z.number().finite().gt(-100_000_000_000).lt(100_000_000_000);
const highlightRank = z.number().int().min(1).max(MAX_HIGHLIGHT_RANK);
const status = z.enum(CATALOG_STATUSES);

const createFieldBody = z
  .object({
    key,
    label,
    helpText: helpText.optional(),
    type: z.enum(FIELD_TYPES),
    appliesTo: z.enum(FIELD_APPLIES_TO).optional(),
    unit: unit.nullable().optional(),
    min: bound.nullable().optional(),
    max: bound.nullable().optional(),
    required: z.boolean().optional(),
    filterable: z.boolean().optional(),
    highlightRank: highlightRank.nullable().optional(),
  })
  .strict();

// No `key`, `type` or `appliesTo`: all three are fixed once a field exists (.strict() rejects them).
const updateFieldBody = z
  .object({
    label: label.optional(),
    helpText: helpText.optional(),
    unit: unit.nullable().optional(),
    min: bound.nullable().optional(),
    max: bound.nullable().optional(),
    required: z.boolean().optional(),
    filterable: z.boolean().optional(),
    highlightRank: highlightRank.nullable().optional(),
    status: status.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');

const createOptionBody = z.object({ key, label }).strict();
const updateOptionBody = z
  .object({ label: label.optional(), status: status.optional() })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');

const reorderBody = z.object({ orderedIds: z.array(z.string().uuid()).min(1) }).strict();

const tags = ['Admin Catalogue'];

// Thin controllers: validate → service → `{ data }`. Template rules live in field-admin.service.
// Fields are read through GET /admin/categories/:id.
const adminCatalogFieldRoutes: FastifyPluginAsync = async (fastify) => {
  const write = fastify.requireAdminRole('category_manager');

  fastify.post('/admin/categories/:id/fields', { schema: { tags }, preHandler: write }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = createFieldBody.parse(request.body);
    reply.code(201);
    return { data: await createField(fastify.db, request.admin!.adminId, id, body) };
  });

  fastify.patch('/admin/fields/:id', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = updateFieldBody.parse(request.body);
    return { data: await updateField(fastify.db, request.admin!.adminId, id, patch) };
  });

  fastify.post('/admin/categories/:id/fields/reorder', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { orderedIds } = reorderBody.parse(request.body);
    await reorderFields(fastify.db, request.admin!.adminId, id, orderedIds);
    return { data: null };
  });

  fastify.post('/admin/fields/:id/options', { schema: { tags }, preHandler: write }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = createOptionBody.parse(request.body);
    reply.code(201);
    return { data: await createOption(fastify.db, request.admin!.adminId, id, body) };
  });

  fastify.patch('/admin/options/:id', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = updateOptionBody.parse(request.body);
    return { data: await updateOption(fastify.db, request.admin!.adminId, id, patch) };
  });

  fastify.post('/admin/fields/:id/options/reorder', { schema: { tags }, preHandler: write }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { orderedIds } = reorderBody.parse(request.body);
    await reorderOptions(fastify.db, request.admin!.adminId, id, orderedIds);
    return { data: null };
  });
};

export default adminCatalogFieldRoutes;
