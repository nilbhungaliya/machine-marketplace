import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';

// Optional: with REDIS_URL unset the decorator is never added.
declare module 'fastify' {
  interface FastifyInstance {
    redis?: Redis;
  }
}

/** For callers that cannot work without Redis (offer expiry, matching jobs, rate limits). */
export function requireRedis(fastify: FastifyInstance): Redis {
  if (!fastify.redis) throw new Error('Redis is not configured — set REDIS_URL');
  return fastify.redis;
}

export default fp(async (fastify) => {
  if (!process.env.REDIS_URL) {
    fastify.log.warn('REDIS_URL not set — Redis features disabled');
    return;
  }
  const redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 10_000,
  });
  redis.on('error', (err: Error) => fastify.log.error({ err }, 'Redis error'));
  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => {
    await redis.quit();
  });
});
