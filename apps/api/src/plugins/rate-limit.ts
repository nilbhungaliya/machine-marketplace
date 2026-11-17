import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

/** Global limit per client per minute. `RATE_LIMIT_MAX` overrides it (the test config raises it). */
function globalMax(): number {
  const raw = process.env.RATE_LIMIT_MAX;
  if (raw === undefined || raw === '') return 120;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`RATE_LIMIT_MAX must be a positive integer, got "${raw}"`);
  return n;
}

/** Redis-backed when Redis is available, so limits survive restarts and span instances. */
export default fp(async (fastify) => {
  await fastify.register(rateLimit, {
    max: globalMax(),
    timeWindow: '1 minute',
    ...(fastify.redis ? { redis: fastify.redis } : {}),
  });
});
