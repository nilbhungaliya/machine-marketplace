import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { reasonBody } from '../../lib/admin-text.js';
import { runTx } from '../../lib/tx-effects.js';
import { businessListFilters, paged } from './list-filters.js';
import {
  PAGE_SIZE_MAX,
  getBusinessDetail,
  listBusinesses,
  releaseGstin,
  revokeGst,
} from '../../services/admin/business-admin.service.js';

const tags = ['Admin Businesses'];

const idParams = z.object({ id: z.string().uuid() });
const listQuery = paged(
  businessListFilters,
  z.coerce.number().int().min(1).default(1),
  z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(25),
);

// Users & businesses (F1 + A2 spec §8.2, §10). Thin: validate → service → `{ data }`. Reads: support, verification
// officers, moderators; Revoke GST and Release GSTIN: verification officers (super_admin passes every role check).
const adminBusinessRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: fastify.requireAdminRole('support', 'verification_officer', 'moderator') };
  const officer = { schema: { tags }, preHandler: fastify.requireAdminRole('verification_officer') };

  fastify.get('/admin/businesses', read, async (request) => {
    const query = listQuery.parse(request.query);
    return { data: await listBusinesses(fastify.db, query) };
  });

  fastify.get('/admin/businesses/:id', read, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await getBusinessDetail(fastify.db, id) };
  });

  fastify.post('/admin/businesses/:id/gst/revoke', officer, async (request) => {
    const { id } = idParams.parse(request.params);
    const { reason } = reasonBody.parse(request.body ?? {});
    // runTx: M14's rental exits queue `rental:updated` emits (after commit).
    return { data: await runTx(fastify, (tx) => revokeGst(tx, request.admin!.adminId, id, reason)) };
  });

  fastify.post('/admin/businesses/:id/gst/release', officer, async (request) => {
    const { id } = idParams.parse(request.params);
    const { reason } = reasonBody.parse(request.body ?? {});
    return { data: await fastify.db.transaction((tx) => releaseGstin(tx, request.admin!.adminId, id, reason)) };
  });
};

export default adminBusinessRoutes;
