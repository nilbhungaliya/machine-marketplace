import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../lib/errors.js';
import { discoveryIpCap, discoveryRateLimits, discoveryRouteLimit, type DiscoveryBucket } from '../services/discovery/rate-key.js';

// Public discovery routes (F4 + F5 spec §7): `optionalUser`, replies `{ data }`. Stubs until their batch (search,
// count-only, suggest, trending: B1; home, browse, brand view, cards: B2), but the rate limits are live now (R17):
// search 120, count-only 240 on its own path, suggest 240, the rest 120 per minute per user / install id, plus the
// per-IP cap across every route here.

const tags = ['Discovery'];

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

  // B1: `SearchRequest` -> `SearchPage` | `SearchRedirect`.
  fastify.post('/discover/search', route('search'), async () => {
    throw notImplemented();
  });
  // B1: `SearchCountRequest` -> `CountOnlyResult`. Its own path, so its own bucket (the limiter runs before the body).
  fastify.post('/discover/search/count', route('count'), async () => {
    throw notImplemented();
  });
  // B1: `?q=` -> `Suggestion[]`.
  fastify.get('/discover/suggest', route('suggest'), async () => {
    throw notImplemented();
  });
  // B1: -> `string[]`.
  fastify.get('/discover/trending', route('other'), async () => {
    throw notImplemented();
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
