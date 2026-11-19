import { afterAll } from 'vitest';

// Runs in every test worker before its suite (vitest `setupFiles`). F4 + F5: discovery's Redis keys get a per-worker
// prefix `test:<runId><worker>:` (alphanumeric), so a test never reads or writes the dev keys, and suites delete their
// own keys with `deleteTestRedisKeys`.
const run = process.env.DISCOVERY_REDIS_PREFIX_RUN ?? Date.now().toString(36);
const worker = (process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '0').replace(/[^a-z0-9]/gi, '');
process.env.DISCOVERY_REDIS_PREFIX = `test:${run}w${worker}:`.toLowerCase();

// Catalogue writes in any suite bump the reader version key under this prefix (F4 + F5 §5.3): after each test file,
// delete every key under the worker's prefix, so the next suite starts from version 0 and the run leaves Redis clean.
afterAll(async () => {
  const prefix = process.env.DISCOVERY_REDIS_PREFIX;
  const url = process.env.REDIS_URL;
  if (!prefix?.startsWith('test:') || !url) return;
  const { Redis } = await import('ioredis');
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    // Redis down: the suites that need it fail on their own.
  } finally {
    redis.disconnect();
  }
});
