import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { listSavedListings, saveListing, unsaveListing } from '../services/discovery/saved.service.js';

// Saved listings (F4 + F5 spec §4.4, §7): `requireUser`. Thin: Zod-parse → service → `{ data }`.

const tags = ['Saved listings'];
const params = z.object({ listingId: z.string().uuid() }).strict();
const listQuery = z.object({ cursor: z.string().max(2_000).optional() }).strict();

const savedListingRoutes: FastifyPluginAsync = async (fastify) => {
  const opts = { schema: { tags }, preHandler: fastify.requireUser };
  const viewerOf = (request: FastifyRequest) => ({ userId: request.user!.userId, businessId: request.user!.businessId });

  // `?cursor=` -> `SavedListingsPage`.
  fastify.get('/users/me/saved-listings', opts, async (request) => {
    const { cursor } = listQuery.parse(request.query ?? {});
    return { data: await listSavedListings(fastify.db, viewerOf(request), cursor) };
  });
  // -> `SaveListingResult` ({ saved: true }); 404 LISTING_NOT_FOUND, 409 CANNOT_SAVE_OWN_LISTING / SAVED_LIMIT.
  fastify.put('/users/me/saved-listings/:listingId', opts, async (request) => {
    const { listingId } = params.parse(request.params);
    return { data: await saveListing(fastify.db, viewerOf(request), listingId) };
  });
  // -> `SaveListingResult` ({ saved: false }), always.
  fastify.delete('/users/me/saved-listings/:listingId', opts, async (request) => {
    const { listingId } = params.parse(request.params);
    return { data: await unsaveListing(fastify.db, request.user!.userId, listingId) };
  });
};

export default savedListingRoutes;
