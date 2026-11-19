import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests never touch the dev database. They run against TEST_DATABASE_URL / TEST_REDIS_URL from the root .env
// (or the shell), which replace DATABASE_URL / REDIS_URL inside the test workers. src/env.ts's dotenv call does
// not override variables that are already set.
const fileEnv = loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), processEnv: {} }).parsed ?? {};
const pick = (key: string): string | undefined => process.env[key] || fileEnv[key] || undefined;

const testDatabaseUrl = pick('TEST_DATABASE_URL');
const testRedisUrl = pick('TEST_REDIS_URL');
if (!testDatabaseUrl || !testRedisUrl) {
  throw new Error(
    'TEST_DATABASE_URL and TEST_REDIS_URL must be set: tests need their own database and Redis (see CLAUDE.md "Local database").',
  );
}
// Name check, not just a string compare: `localhost` vs `127.0.0.1` or an extra `?sslmode=` would pass a compare
// while pointing at the same database.
const testDbName = decodeURIComponent(new URL(testDatabaseUrl).pathname.replace(/^\//, ''));
if (!testDbName.endsWith('_test')) {
  throw new Error(`TEST_DATABASE_URL's database must be named *_test (got "${testDbName}"): tests delete and rewrite data.`);
}

// F4 + F5: discovery Redis keys (reader version key, rate-limit buckets) carry a prefix of this run; the setup file adds
// the worker, so tests never touch the unprefixed (dev) keys and suites can delete their own.
const runId = `${Date.now().toString(36)}${process.pid.toString(36)}`;

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['./__tests__/_helpers/setup-env.ts'],
    env: {
      DATABASE_URL: testDatabaseUrl,
      REDIS_URL: testRedisUrl,
      // Suites fire hundreds of requests a minute from one client; the 120/min production limit would 429 them.
      RATE_LIMIT_MAX: '1000000',
      // F6 + F7 (P8): the message / offer / deal group limits, raised the same way; a limit test builds its own app.
      GROUP_RATE_LIMIT_MAX: '1000000',
      // Same for the GST per-IP limit (lookup, otp/send): every suite calls from 127.0.0.1. One test lowers it.
      GST_IP_RATE_MAX: '1000000',
      // No proxy in tests, whatever a developer's .env says: request.ip (and the per-IP limits) must be the client's.
      TRUST_PROXY_HOPS: '0',
      // F2 (plan rev 3, I5): a developer's .env must not leak listing media settings into tests. Photos are required
      // to publish, media URLs are null and no CDN purge can be configured; tests that need values set them per test
      // and restore them.
      LISTING_MEDIA_OPTIONAL: 'false',
      MEDIA_PUBLIC_BASE_URL: '',
      AWS_S3_PUBLIC_BUCKET: '',
      CLOUDFLARE_ZONE_ID: '',
      CLOUDFLARE_API_TOKEN: '',
      // F4 + F5 (§4.8): a fixed test secret, whatever the developer's .env says; never used outside tests.
      DISCOVERY_CURSOR_SECRET: 'test-only-discovery-cursor-secret-0123456789abcdef',
      DISCOVERY_REDIS_PREFIX_RUN: runId,
      // Discovery's per-user / install-id limits and its per-IP cap (R17): raised like RATE_LIMIT_MAX; the core suite
      // lowers them for its own app.
      DISCOVERY_RATE_LIMIT_MAX: '1000000',
      DISCOVERY_IP_RATE_MAX: '1000000',
    },
    // Integration tests share ONE Postgres + Redis; parallel files trample each
    // other's fixtures. Every suite must delete what it inserts in afterAll.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
