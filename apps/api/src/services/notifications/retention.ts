import { sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';

/**
 * Notification retention (F6 + F7 spec §11.6, §14): rows whose last activity (`updated_at`, which a grouped chat row
 * moves) is older than 90 days are deleted, with their deliveries (cascade), in batches. L4-4 owns this file.
 */

export const NOTIFICATION_RETENTION_DAYS = 90;
const BATCH = 1000;

/** The daily `notification-retention` job. Returns how many rows went. */
export async function deleteOldNotifications(db: Db): Promise<number> {
  let deleted = 0;
  for (;;) {
    const res = await db.execute(sql`
      DELETE FROM notifications WHERE id IN (
        SELECT id FROM notifications
         WHERE updated_at < now() - make_interval(days => ${NOTIFICATION_RETENTION_DAYS}::int)
         LIMIT ${BATCH}
           FOR UPDATE SKIP LOCKED)`);
    const n = res.rowCount ?? 0;
    deleted += n;
    if (n < BATCH) break;
  }
  return deleted;
}
