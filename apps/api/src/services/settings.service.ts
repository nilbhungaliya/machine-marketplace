import { and, inArray, lt, sql } from 'drizzle-orm';
import {
  APP_SETTINGS,
  appSettingDefaults,
  validateSettings,
  type AppSettingKey,
  type AppSettingsValues,
} from '@mpm/shared-types';
import type { Db, Tx } from '../db/index.js';
import { appSettings, listings } from '../db/schema.js';
import { ValidationError } from '../lib/errors.js';
import { writeAudit } from './audit.service.js';

// Marketplace settings (F2 spec §12, R10): a key / value table whose registry (`APP_SETTINGS`) is code. A missing row
// means the default, so nothing needs seeding; no cache, so a change applies to the very next read.

const KEYS = new Set<string>(APP_SETTINGS.map((s) => s.key));

export type SettingsPatch = Partial<Record<AppSettingKey, unknown>>;

/** Every setting: the stored value, else the default. One small query. */
export async function getSettings(conn: Db | Tx): Promise<AppSettingsValues> {
  const rows = await conn.select({ key: appSettings.key, value: appSettings.value }).from(appSettings);
  const values = appSettingDefaults();
  for (const row of rows) {
    if (KEYS.has(row.key) && typeof row.value === 'number') values[row.key as AppSettingKey] = row.value;
  }
  return values;
}

/**
 * Saves the changed settings (super admin, §11.5). Validated whole (range, whole numbers, reminder < expiry) against the
 * stored values merged with the patch: `400 SETTING_INVALID` with `details.key`. Upserts the changed keys and writes one
 * `setting.update` audit row with before / after maps of those keys. Run inside a transaction: an advisory lock
 * serialises two saves, so the cross-field rule can't be broken by two admins changing one key each.
 */
export async function updateSettings(tx: Tx, adminId: string, patch: SettingsPatch): Promise<AppSettingsValues> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('app_settings'))`);
  const current = await getSettings(tx);
  const merged = { ...current, ...patch } as AppSettingsValues;
  const problem = validateSettings(merged);
  if (problem) throw new ValidationError(problem.message, { key: problem.key }, 'SETTING_INVALID');

  const changed = (Object.keys(patch) as AppSettingKey[]).filter((k) => merged[k] !== current[k]);
  if (changed.length === 0) return current;

  for (const key of changed) {
    await tx
      .insert(appSettings)
      .values({ key, value: merged[key], updatedByAdminId: adminId })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: merged[key], updatedByAdminId: adminId, updatedAt: sql`now()` },
      });
  }
  await writeAudit(tx, {
    adminId,
    action: 'setting.update',
    entityType: 'setting',
    entityId: 'marketplace',
    before: Object.fromEntries(changed.map((k) => [k, current[k]])),
    after: Object.fromEntries(changed.map((k) => [k, merged[k]])),
  });
  return merged;
}

/** How many `live` / `rented` listings an expiry of `days` would expire on the next job run (R56). */
export async function expiryImpact(conn: Db | Tx, days: number): Promise<number> {
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(listings)
    .where(
      and(
        inArray(listings.status, ['live', 'rented']),
        lt(listings.refreshedAt, sql`now() - make_interval(days => ${days}::int)`),
      ),
    );
  return row!.n;
}
