import type { FastifyRequest } from 'fastify';

/**
 * A per-signed-in-user route limit over `timeWindow` (default 10 minutes) (@fastify/rate-limit route config). Runs after `requireUser`
 * (`hook: 'preHandler'`), so the key is the user. Each route counts on its own.
 */
export const perUser = (max: number, timeWindow: string = '10 minutes') => ({
  rateLimit: {
    max,
    timeWindow,
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) => (request.user ? `user:${request.user.userId}` : `ip:${request.ip}`),
  },
});
