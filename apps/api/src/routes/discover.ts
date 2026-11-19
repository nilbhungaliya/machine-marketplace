import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { searchCountSchema, searchRequestSchema } from '../services/discovery/filters.js';
import { countSearch, search } from '../services/discovery/search.service.js';
import { suggest } from '../services/discovery/suggest.service.js';
import { trending } from '../services/discovery/trending.service.js';
import { discoveryIpCap, discoveryRateLimits, discoveryRouteLimit, type DiscoveryBucket } from '../services/discovery/rate-key.js';

// Public discovery routes (F4 + F5 spec §7): `optionalUser`, replies `{ data }`. Search, count-only, suggest and trending
// are built (B1); home, browse, brand view and cards are stubs until B2, but the rate limits are live now (R17):
// search 120, count-only 240 on its own path, suggest 240, the rest 120 per minute per user / install id, plus the
// per-IP cap across every route here.

const tags = ['Discovery'];

const suggestQuerySchema = z.object({ q: z.string().max(200).optional() }).strict();

/** What a route stub answers until its batch builds it. */
export function notImplemented(): AppError {
  return new AppError('Not implemented yet', 501, 'NOT_IMPLEMENTED');
}

const discoverRoutes: FastifyPluginAsync = async (fastify) => {
  const limits = discoveryRateLimits();
  // Encapsulated (no fastify-plugin): the cap applies to this plugin's routes only.
  fastify.addHook('onRequest', discoveryIpCap(fastify.redis, limits.ipOuter));
  const route = (bucket: DiscoveryBucket) => ({
    schema: { tags },
    preHandler: fastify.optionalUser,
    config: discoveryRouteLimit(bucket, limits),
  });

  const viewerOf = (request: FastifyRequest) => (request.user ? { userId: request.user.userId, businessId: request.user.businessId } : null);

  // `SearchRequest` -> `SearchPage` | `SearchRedirect` (§5, §7).
  fastify.post('/discover/search', route('search'), async (request) => {
    const body = searchRequestSchema.parse(request.body ?? {});
    return { data: await search(fastify.db, body, viewerOf(request), { redis: fastify.redis }) };
  });
  // `SearchCountRequest` -> `CountOnlyResult` (§5.11). Its own path, so its own bucket (the limiter runs before the body).
  fastify.post('/discover/search/count', route('count'), async (request) => {
    const body = searchCountSchema.parse(request.body ?? {});
    return { data: await countSearch(fastify.db, body, viewerOf(request), { redis: fastify.redis }) };
  });
  // `?q=` -> `Suggestion[]` (§5.12).
  fastify.get('/discover/suggest', route('suggest'), async (request) => {
    const { q } = suggestQuerySchema.parse(request.query ?? {});
    return { data: await suggest(fastify.db, q) };
  });
  // -> `string[]` (§5.12).
  fastify.get('/discover/trending', route('other'), async () => {
    return { data: await trending(fastify.db) };
  });
  // B2: `HomeRequest` -> `HomeView`.
  fastify.post('/discover/home', route('other'), async () => {
    throw notImplemented();
  });
  // B2: `BrowseRequest` -> `BrowseView`.
  fastify.post('/discover/browse', route('other'), async () => {
    throw notImplemented();
  });
  // B2: `BrandBrowseRequest` -> `BrandBrowseView`.
  fastify.post('/discover/browse/brand', route('other'), async () => {
    throw notImplemented();
  });
  // B2: `CardsRequest` -> `ListingCard[]`.
  fastify.post('/discover/cards', route('other'), async () => {
    throw notImplemented();
  });
};

export default discoverRoutes;
