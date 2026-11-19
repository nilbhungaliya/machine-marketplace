import type { Db } from '../../db/index.js';

/**
 * Notification retention (F6 + F7 spec §11, §14): rows older than 90 days and their deliveries. L4-4 owns this file.
 */

// F6F7-STUB(L4): L4-4 implements the delete.
export async function deleteOldNotifications(_db: Db): Promise<number> {
  return 0;
}
