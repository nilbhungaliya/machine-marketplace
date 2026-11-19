import '../env.js';
import { db, pool } from './index.js';
import { backfillSearch } from '../services/discovery/refresh-jobs.js';

/**
 * Rebuilds every listing's search columns (F4 + F5 spec §4.6): search title text, search text, search point. Batches
 * of 200 in id order, each its own transaction; idempotent, safe to run again.
 *   pnpm --filter @mpm/api db:backfill:search
 */
async function main() {
  const total = await backfillSearch(db, { log: (n) => console.log(`search text: ${n} listings`) });
  console.log(`search text rebuilt for ${total} listings`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
