import '../env.js';
import { db, pool } from './index.js';
import { industrialAreas } from './schema.js';
import { SURAT_INDUSTRIAL_AREAS } from './seed-data/industrial-areas.js';

/**
 * Loads the launch city's industrial areas (F1 spec §4.3). Insert-only, as the catalogue loader: refuses when
 * `industrial_areas` has any row, since admins manage the list after the seed.
 *   pnpm --filter @mpm/api db:seed:industrial-areas
 */
async function main() {
  const inserted = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: industrialAreas.id }).from(industrialAreas).limit(1);
    if (existing) throw new Error('Industrial areas already loaded: the seed only fills an empty table. Edit them in the admin panel.');
    const rows = await tx.insert(industrialAreas).values(SURAT_INDUSTRIAL_AREAS).returning({ id: industrialAreas.id });
    return rows.length;
  });
  console.log(`industrial areas: ${inserted}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
