import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { reasonBody } from '../../lib/admin-text.js';
import { runTx } from '../../lib/tx-effects.js';
import { moderateReview, type ReviewModeration } from '../../services/reviews/review-moderation.service.js';

// Admin review moderation (F6 + F7 spec §10.6, §16.2, P9). L4 owns this file (L4-2). Role: moderator. Each writes
// `audit_log` (`review.hide`, `review.unhide`, `review.hide_reply`) in the same transaction.

const tags = ['Admin reviews'];
const idParams = z.object({ id: z.string().uuid() });

const ACTIONS: Array<[path: string, action: ReviewModeration]> = [
  ['hide', 'hide'],
  ['unhide', 'unhide'],
  ['hide-reply', 'hide_reply'],
];

const adminReviewRoutes: FastifyPluginAsync = async (fastify) => {
  const moderator = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator') };
  for (const [path, action] of ACTIONS) {
    fastify.post(`/admin/reviews/:id/${path}`, moderator, async (request) => {
      const { id } = idParams.parse(request.params);
      const { reason } = reasonBody.parse(request.body ?? {});
      return { data: await runTx(fastify, (tx) => moderateReview(tx, request.admin!.adminId, id, action, reason)) };
    });
  }
};

export default adminReviewRoutes;
