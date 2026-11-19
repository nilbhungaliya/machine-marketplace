import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { discoveryRedisPrefix } from '../env.js';

/** Global limit per client per minute. `RATE_LIMIT_MAX` overrides it (the test config raises it). */
function globalMax(): number {
  const raw = process.env.RATE_LIMIT_MAX;
  if (raw === undefined || raw === '') return 120;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`RATE_LIMIT_MAX must be a positive integer, got "${raw}"`);
  return n;
}

/**
 * Redis-backed when Redis is available, so limits survive restarts and span instances. Routes may set their own limit
 * and key in `config.rateLimit` (the discovery routes do, `services/discovery/rate-key.ts`). Keys carry
 * DISCOVERY_REDIS_PREFIX (empty in dev and production), so a test worker's buckets are its own.
 */
export default fp(async (fastify) => {
  await fastify.register(rateLimit, {
    max: globalMax(),
    timeWindow: '1 minute',
    nameSpace: `${discoveryRedisPrefix()}fastify-rate-limit-`,
    ...(fastify.redis ? { redis: fastify.redis } : {}),
  });
});
