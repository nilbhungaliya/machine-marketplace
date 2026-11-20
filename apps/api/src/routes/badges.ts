import type { FastifyPluginAsync } from 'fastify';
import type { Badges } from '@mpm/shared-types';
import { unreadThreadCount } from '../services/chat/inbox.service.js';
import { dealsYourTurnCount } from '../services/deals/deal-read.service.js';
import { notificationUnreadCount } from '../services/notifications/notification-read.service.js';
import { requestsForYouCount } from '../services/part-requests/request-counts.js';
import { countRentalsYourTurn } from '../services/rentals/booking-read.service.js';

// Tab badges (F6 + F7 spec §12.2; F8 §12.4; M14 §6.6): `Badges { unreadThreads, dealsYourTurn, notificationsUnread,
// requestsForYou, rentalsYourTurn }`.

const badgeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/users/me/badges', { schema: { tags: ['Chat'] }, preHandler: [fastify.requireUser] }, async (request) => {
    const user = request.user!;
    const data: Badges = {
      unreadThreads: await unreadThreadCount(fastify.db, user),
      dealsYourTurn: await dealsYourTurnCount(fastify.db, user),
      notificationsUnread: await notificationUnreadCount(fastify.db, user.userId),
      requestsForYou: await requestsForYouCount(fastify.db, user),
      rentalsYourTurn: user.businessId ? await countRentalsYourTurn(fastify.db, user.businessId) : 0,
    };
    return { data };
  });
};

export default badgeRoutes;
