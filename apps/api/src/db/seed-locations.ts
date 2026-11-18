import '../env.js';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { db, pool } from './index.js';
import { loadDirectory } from './seed-locations/load.js';
import { parseDirectory } from './seed-locations/parse.js';

/**
 * Loads the pincode directory (F1 spec §4.4) in one transaction. Source and refresh process: infra/seed/README.md.
 *   pnpm --filter @mpm/api db:seed:locations             refuses if pincode_offices is not empty
 *   pnpm --filter @mpm/api db:seed:locations -- --reset  replaces the directory
 *
 * Folder: SEED_DATA_DIR (the Dockerfile sets /app/seed), else the repo's infra/seed relative to this file.
 */
const seedDir = process.env.SEED_DATA_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../../infra/seed');

async function main() {
  const csv = gunzipSync(readFileSync(join(seedDir, 'pincode-directory.csv.gz'))).toString('utf8');
  const rows = parseDirectory(csv);
  const reset = process.argv.includes('--reset');
  const counts = await db.transaction((tx) => loadDirectory(tx, rows, { reset }));
  console.log(`offices: ${counts.offices}\npincodes: ${counts.pincodes}\npointsMissing: ${counts.pointsMissing}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
