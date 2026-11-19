// Runs in every test worker before its suite (vitest `setupFiles`). F4 + F5: discovery's Redis keys get a per-worker
// prefix `test:<runId><worker>:` (alphanumeric), so a test never reads or writes the dev keys, and suites delete their
// own keys with `deleteTestRedisKeys`.
const run = process.env.DISCOVERY_REDIS_PREFIX_RUN ?? Date.now().toString(36);
const worker = (process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '0').replace(/[^a-z0-9]/gi, '');
process.env.DISCOVERY_REDIS_PREFIX = `test:${run}w${worker}:`.toLowerCase();
