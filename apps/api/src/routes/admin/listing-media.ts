import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { reasonBody } from '../../lib/admin-text.js';
import { adminDeleteMedia } from '../../services/listings/listing-media.service.js';

// Admin media delete (F2 spec §11.3, §11.6; plan Task 16): moderators (super_admin passes). Never checks the listing's
// version (R53). The response carries the CDN purge result; on `failed` the page says "Deleted. The CDN copy may take a
// while to clear."

const tags = ['Admin Listings'];
const mediaParams = z.object({ id: z.string().uuid(), mediaId: z.string().uuid() });

const adminListingMediaRoutes: FastifyPluginAsync = async (fastify) => {
  const moderator = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator') };

  fastify.delete('/admin/listings/:id/media/:mediaId', moderator, async (request) => {
    const { id, mediaId } = mediaParams.parse(request.params);
    const { reason } = reasonBody.parse(request.body ?? {});
    return { data: await adminDeleteMedia(fastify, request.admin!.adminId, id, mediaId, reason, request.log) };
  });
};

export default adminListingMediaRoutes;
