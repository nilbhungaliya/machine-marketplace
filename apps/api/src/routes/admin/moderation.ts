import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MODERATION_TABS } from '@mpm/shared-types';
import { moderationCounts, moderationQueue } from '../../services/listings/listing-admin.service.js';

const tags = ['Admin Moderation'];

const queueQuery = z
  .object({
    tab: z.enum(MODERATION_TABS).default('review'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();

// Listing moderation queue (F2 spec §11.1, §11.6). Moderators (super_admin passes every role check).
const adminModerationRoutes: FastifyPluginAsync = async (fastify) => {
  const moderator = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator') };

  // `AdminModerationQueue`: Review / Reported / Decided (90 days), 50 a page.
  fastify.get('/admin/moderation/queue', moderator, async (request, reply) => {
    const { tab, page } = queueQuery.parse(request.query);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await moderationQueue(fastify.db, tab, page) };
  });

  // `ModerationCounts`: the nav badge `moderationWaiting` = review + reported.
  fastify.get('/admin/moderation/counts', moderator, async (_request, reply) => {
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await moderationCounts(fastify.db) };
  });
};

export default adminModerationRoutes;
