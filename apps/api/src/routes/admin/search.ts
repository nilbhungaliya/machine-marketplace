import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../discover.js';

// Search synonyms and insights (F4 + F5 spec §7.1, §9): `category_manager` (super_admin passes). Every mutation is
// audit-logged and synonym writes bump the reader version key. Stubs until B2.

const tags = ['Admin Search'];

const adminSearchRoutes: FastifyPluginAsync = async (fastify) => {
  const opts = { schema: { tags }, preHandler: fastify.requireAdminRole('category_manager') };

  // B2: `?q=&targetKind=&cursor=` -> synonyms with target names.
  fastify.get('/admin/search/synonyms', opts, async () => {
    throw notImplemented();
  });
  // B2: `SearchSynonymInput` -> `SearchSynonym`; 409 SYNONYM_EXISTS, 400 SYNONYM_TARGET_INVALID.
  fastify.post('/admin/search/synonyms', opts, async () => {
    throw notImplemented();
  });
  fastify.patch('/admin/search/synonyms/:id', opts, async () => {
    throw notImplemented();
  });
  fastify.delete('/admin/search/synonyms/:id', opts, async () => {
    throw notImplemented();
  });
  // B2: `{ q }` -> the `QueryReading` the reader produces now.
  fastify.post('/admin/search/synonyms/preview', opts, async () => {
    throw notImplemented();
  });
  // B2: -> `ZeroResultRow[]` (top 50 of 30 days).
  fastify.get('/admin/search/zero-results', opts, async () => {
    throw notImplemented();
  });
  // B2: -> `TrendingRow[]` (top 20 of 7 days, hidden ones marked).
  fastify.get('/admin/search/trending', opts, async () => {
    throw notImplemented();
  });
  fastify.put('/admin/search/trending-hidden/:normalized', opts, async () => {
    throw notImplemented();
  });
  fastify.delete('/admin/search/trending-hidden/:normalized', opts, async () => {
    throw notImplemented();
  });
};

export default adminSearchRoutes;
