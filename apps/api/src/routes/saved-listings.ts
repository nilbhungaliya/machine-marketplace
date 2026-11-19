import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from './discover.js';

// Saved listings (F4 + F5 spec §4.4, §7): `requireUser`. Stubs until B2.

const tags = ['Saved listings'];

const savedListingRoutes: FastifyPluginAsync = async (fastify) => {
  const opts = { schema: { tags }, preHandler: fastify.requireUser };

  // B2: `?cursor=` -> `SavedListingsPage`.
  fastify.get('/users/me/saved-listings', opts, async () => {
    throw notImplemented();
  });
  // B2: -> `SaveListingResult` ({ saved: true }); 404 LISTING_NOT_FOUND, 409 CANNOT_SAVE_OWN_LISTING / SAVED_LIMIT.
  fastify.put('/users/me/saved-listings/:listingId', opts, async () => {
    throw notImplemented();
  });
  // B2: -> `SaveListingResult` ({ saved: false }), always.
  fastify.delete('/users/me/saved-listings/:listingId', opts, async () => {
    throw notImplemented();
  });
};

export default savedListingRoutes;
