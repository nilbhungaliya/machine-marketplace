import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LISTING_PHOTOS_MAX, LISTING_VIDEOS_MAX, MEDIA_ROLES, MEDIA_TYPES } from '@mpm/shared-types';
import { perUser } from '../lib/per-user-limit.js';
import { attachMedia, deleteMedia, presignMedia, reorderMedia } from '../services/listings/listing-media.service.js';

// Listing media (F2 spec §6.2, §14). Thin: Zod-parse → service → `{ data }`. Shapes here; key format, roles, sizes,
// sniffing, limits and editability in the service. Every route answers `503 STORAGE_UNAVAILABLE` without media storage.

const tags = ['Listing media'];

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const mediaParams = z.object({ id: uuid, mediaId: uuid });

const presignBody = z
  .object({
    type: z.enum(MEDIA_TYPES),
    uploadId: uuid.optional(),
    files: z
      .array(z.object({ role: z.enum(MEDIA_ROLES), contentType: z.string().max(100), size: z.number().int().positive() }).strict())
      .length(2),
  })
  .strict();

const key = z.string().min(1).max(300);
const attachBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('photo'), uploadId: uuid, keys: z.object({ full: key, thumb: key }).strict() }).strict(),
  z
    .object({
      type: z.literal('video'),
      uploadId: uuid,
      keys: z.object({ video: key, poster: key }).strict(),
      // Missing or over 60 500 ms → the service's `400 VIDEO_TOO_LONG`.
      durationMs: z.number().int().positive().optional(),
    })
    .strict(),
]);

const orderBody = z.object({ ids: z.array(uuid).max(LISTING_PHOTOS_MAX + LISTING_VIDEOS_MAX) }).strict();

const listingMediaRoutes: FastifyPluginAsync = async (fastify) => {
  const user = { schema: { tags }, preHandler: fastify.requireUser };

  // Signed PUTs for one item's two files (300 s); the app presigns again with the same uploadId on a retry.
  fastify.post('/listings/:id/media/presign', { ...user, config: perUser(300) }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = presignBody.parse(request.body);
    return { data: await presignMedia(fastify.db, request.user!, id, body) };
  });

  // Checks the uploads, copies them to the public bucket and attaches the item (201).
  fastify.post('/listings/:id/media', { ...user, config: perUser(300) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = attachBody.parse(request.body);
    const data = await attachMedia(fastify.db, request.user!, id, body, request.log);
    return reply.status(201).send({ data });
  });

  // Every media id of the listing in the new order; the first photo is the cover.
  fastify.put('/listings/:id/media/order', { ...user, config: perUser(300) }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { ids } = orderBody.parse(request.body);
    return { data: await fastify.db.transaction((tx) => reorderMedia(tx, request.user!, id, ids)) };
  });

  // Not the last photo of a non-draft listing; objects and CDN copies go after commit.
  fastify.delete('/listings/:id/media/:mediaId', { ...user, config: perUser(300) }, async (request) => {
    const { id, mediaId } = mediaParams.parse(request.params);
    return { data: await deleteMedia(fastify.db, request.user!, id, mediaId, request.log) };
  });
};

export default listingMediaRoutes;
