import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DISCOVERY_LIMITS } from '@mpm/shared-types';
import { browse, browseBrand } from '../services/discovery/browse.service.js';
import { discoverCards } from '../services/discovery/cards.service.js';
import { kindsSchema, originSchema, radiusSchema, searchCountSchema, searchRequestSchema } from '../services/discovery/filters.js';
import { home } from '../services/discovery/home.service.js';
import { countSearch, search } from '../services/discovery/search.service.js';
import { suggest } from '../services/discovery/suggest.service.js';
import { trending } from '../services/discovery/trending.service.js';
import { discoveryIpCap, discoveryRateLimits, discoveryRouteLimit, type DiscoveryBucket } from '../services/discovery/rate-key.js';

// Public discovery routes (F4 + F5 spec §7): `optionalUser`, replies `{ data }`. Rate limits (R17): search 120,
// count-only 240 on its own path, suggest 240, the rest 120 per minute per user / install id, plus the per-IP cap across
// every route here.

const tags = ['Discovery'];

const suggestQuerySchema = z.object({ q: z.string().max(200).optional() }).strict();
const uuid = z.string().uuid();
const homeSchema = z.object({ origin: originSchema.optional(), radiusKm: radiusSchema.optional() }).strict();
const browseSchema = z
  .object({ parentId: uuid.nullable().optional(), kinds: kindsSchema.optional(), origin: originSchema.optional(), radiusKm: radiusSchema.optional() })
  .strict();
const brandSchema = z
  .object({ brandId: uuid, kinds: kindsSchema.optional(), origin: originSchema.optional(), radiusKm: radiusSchema.optional() })
  .strict();
const cardsSchema = z.object({ ids: z.array(uuid).max(DISCOVERY_LIMITS.cardsMaxIds), origin: originSchema.optional() }).strict();

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
  // `HomeRequest` -> `HomeView` (§7, §8.3).
  fastify.post('/discover/home', route('other'), async (request) => {
    const body = homeSchema.parse(request.body ?? {});
    return { data: await home(fastify.db, body, viewerOf(request)) };
  });
  // `BrowseRequest` -> `BrowseView` (§7, §8.4).
  fastify.post('/discover/browse', route('other'), async (request) => {
    const body = browseSchema.parse(request.body ?? {});
    return { data: await browse(fastify.db, body, viewerOf(request)) };
  });
  // `BrandBrowseRequest` -> `BrandBrowseView`.
  fastify.post('/discover/browse/brand', route('other'), async (request) => {
    const body = brandSchema.parse(request.body ?? {});
    return { data: await browseBrand(fastify.db, body, viewerOf(request)) };
  });
  // `CardsRequest` -> `ListingCard[]` (recently viewed, §8.5).
  fastify.post('/discover/cards', route('other'), async (request) => {
    const body = cardsSchema.parse(request.body ?? {});
    return { data: await discoverCards(fastify.db, body, viewerOf(request)) };
  });
};

export default discoverRoutes;
