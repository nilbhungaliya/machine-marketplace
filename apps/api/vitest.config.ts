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

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    env: {
      DATABASE_URL: testDatabaseUrl,
      REDIS_URL: testRedisUrl,
      // Suites fire hundreds of requests a minute from one client; the 120/min production limit would 429 them.
      RATE_LIMIT_MAX: '1000000',
      // Same for the GST per-IP limit (lookup, otp/send): every suite calls from 127.0.0.1. One test lowers it.
      GST_IP_RATE_MAX: '1000000',
    },
    // Integration tests share ONE Postgres + Redis; parallel files trample each
    // other's fixtures. Every suite must delete what it inserts in afterAll.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
