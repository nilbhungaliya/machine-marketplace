import '../env.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/**
 * One-shot migration runner, executed on container start before the server
 * (see apps/api/Dockerfile). Drizzle records applied migrations in
 * `__drizzle_migrations`, so this is a no-op when the DB is already current.
 *
 * Folder: MIGRATIONS_DIR (the Dockerfile sets /app/migrations), else the repo's
 * infra/migrations relative to this file — which works from src/ (tsx) and dist/.
 */
const migrationsFolder =
  process.env.MIGRATIONS_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../infra/migrations');

// `--test` migrates the test database (TEST_DATABASE_URL) instead of the dev one.
const target = process.argv.includes('--test') ? 'TEST_DATABASE_URL' : 'DATABASE_URL';

async function main() {
  const connectionString = process.env[target];
  if (!connectionString) throw new Error(`${target} is not set`);
  const pool = new pg.Pool({ connectionString, max: 1 });
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(drizzle(pool), { migrationsFolder });
  console.log('[migrate] up to date');
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
