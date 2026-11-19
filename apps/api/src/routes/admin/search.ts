import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SYNONYM_TARGETS } from '@mpm/shared-types';
import { adminTrending, hideTrending, unhideTrending, zeroResults } from '../../services/discovery/insights.service.js';
import {
  createSynonym,
  deleteSynonym,
  listSynonyms,
  previewReading,
  updateSynonym,
} from '../../services/discovery/synonym-admin.service.js';

// Search synonyms and insights (F4 + F5 spec §7.1, §9): `category_manager` (super_admin passes). Every mutation is
// audit-logged; synonym writes bump the reader version key after they commit. Thin: Zod-parse → service → `{ data }`.

const tags = ['Admin Search'];

const idParams = z.object({ id: z.string().uuid() }).strict();
const normalizedParams = z.object({ normalized: z.string().min(1).max(400) }).strict();
const listQuery = z
  .object({ q: z.string().max(100).optional(), targetKind: z.enum(SYNONYM_TARGETS).optional(), cursor: z.string().max(2_000).optional() })
  .strict();
// Target fields are checked in the service (`400 SYNONYM_TARGET_INVALID`), so only their types are checked here.
const target = {
  targetKind: z.enum(SYNONYM_TARGETS),
  targetId: z.string().uuid().nullable().optional(),
  targetSide: z.string().max(20).nullable().optional(),
  targetWord: z.string().max(200).nullable().optional(),
};
const term = z.string().trim().min(1).max(100);
const createBody = z.object({ term, ...target, isActive: z.boolean().optional() }).strict();
const updateBody = z
  .object({ term: term.optional(), ...target, targetKind: target.targetKind.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to update');
const previewBody = z.object({ q: z.string().max(200) }).strict();

const adminSearchRoutes: FastifyPluginAsync = async (fastify) => {
  const opts = { schema: { tags }, preHandler: fastify.requireAdminRole('category_manager') };

  // `?q=&targetKind=&cursor=` -> `SearchSynonymPage` (with target names).
  fastify.get('/admin/search/synonyms', opts, async (request) => {
    const { cursor, ...filters } = listQuery.parse(request.query ?? {});
    return { data: await listSynonyms(fastify.db, filters, { cursor }) };
  });
  // `SearchSynonymInput` -> `SearchSynonym`; 409 SYNONYM_EXISTS, 400 SYNONYM_TARGET_INVALID.
  fastify.post('/admin/search/synonyms', opts, async (request, reply) => {
    const body = createBody.parse(request.body ?? {});
    reply.code(201);
    return { data: await createSynonym(fastify.db, request.admin!.adminId, body, fastify.redis) };
  });
  fastify.patch('/admin/search/synonyms/:id', opts, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = updateBody.parse(request.body ?? {});
    return { data: await updateSynonym(fastify.db, request.admin!.adminId, id, patch, fastify.redis) };
  });
  fastify.delete('/admin/search/synonyms/:id', opts, async (request) => {
    const { id } = idParams.parse(request.params);
    await deleteSynonym(fastify.db, request.admin!.adminId, id, fastify.redis);
    return { data: null };
  });
  // `{ q }` -> the `QueryReading` the reader produces now.
  fastify.post('/admin/search/synonyms/preview', opts, async (request) => {
    const { q } = previewBody.parse(request.body ?? {});
    return { data: await previewReading(fastify.db, q) };
  });
  // -> `ZeroResultRow[]` (top 50 of 30 days).
  fastify.get('/admin/search/zero-results', opts, async () => ({ data: await zeroResults(fastify.db) }));
  // -> `TrendingRow[]` (top 20 of 7 days, hidden ones marked).
  fastify.get('/admin/search/trending', opts, async () => ({ data: await adminTrending(fastify.db) }));
  // -> `TrendingHiddenResult`.
  fastify.put('/admin/search/trending-hidden/:normalized', opts, async (request) => {
    const { normalized } = normalizedParams.parse(request.params);
    return { data: await hideTrending(fastify.db, request.admin!.adminId, normalized) };
  });
  fastify.delete('/admin/search/trending-hidden/:normalized', opts, async (request) => {
    const { normalized } = normalizedParams.parse(request.params);
    return { data: await unhideTrending(fastify.db, request.admin!.adminId, normalized) };
  });
};

export default adminSearchRoutes;
