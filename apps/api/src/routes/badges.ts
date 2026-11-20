import type { FastifyPluginAsync } from 'fastify';
import type { Badges } from '@mpm/shared-types';
import { unreadThreadCount } from '../services/chat/inbox.service.js';
import { dealsYourTurnCount } from '../services/deals/deal-read.service.js';
import { notificationUnreadCount } from '../services/notifications/notification-read.service.js';

// Tab badges (F6 + F7 spec §12.2): `Badges { unreadThreads, dealsYourTurn, notificationsUnread }`.

const badgeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/users/me/badges', { schema: { tags: ['Chat'] }, preHandler: [fastify.requireUser] }, async (request) => {
    const user = request.user!;
    const data: Badges = {
      unreadThreads: await unreadThreadCount(fastify.db, user),
      dealsYourTurn: await dealsYourTurnCount(fastify.db, user),
      notificationsUnread: await notificationUnreadCount(fastify.db, user.userId),
      requestsForYou: 0,
    };
    return { data };
  });
};

export default badgeRoutes;
