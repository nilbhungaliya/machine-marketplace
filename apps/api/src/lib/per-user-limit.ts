import type { FastifyRequest } from 'fastify';

/**
 * A per-signed-in-user route limit over 10 minutes (@fastify/rate-limit route config). Runs after `requireUser`
 * (`hook: 'preHandler'`), so the key is the user. Each route counts on its own.
 */
export const perUser = (max: number) => ({
  rateLimit: {
    max,
    timeWindow: '10 minutes',
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) => (request.user ? `user:${request.user.userId}` : `ip:${request.ip}`),
  },
});
