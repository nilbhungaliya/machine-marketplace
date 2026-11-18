import '../env.js';
import { db, pool } from './index.js';
import { loadCatalog } from './seed-catalog/load.js';
import { catalogSeed } from './seed-data/catalog/index.js';

/**
 * Loads the starter catalogue (spec §10) in one transaction.
 *   pnpm --filter @mpm/api db:seed:catalog            refuses if the catalogue is not empty
 *   pnpm --filter @mpm/api db:seed:catalog -- --reset deletes the catalogue first (before go-live only)
 */
async function main() {
  const reset = process.argv.includes('--reset');
  if (reset) console.warn('--reset deletes the whole catalogue, including anything admins edited. Use it only before go-live.');
  const counts = await db.transaction((tx) => loadCatalog(tx, catalogSeed, { reset }));
  console.log(`Catalogue ${reset ? 'reset and loaded' : 'loaded'}:`, counts);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
