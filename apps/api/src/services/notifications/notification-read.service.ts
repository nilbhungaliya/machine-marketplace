import type { Db, Tx } from '../../db/index.js';

/**
 * Notification reads (F6 + F7 spec §11). L4-3 owns this file.
 */

/** Unread in-app notifications of the user (the bell badge). */
// F6F7-STUB(L4): L4-3 implements the list and this count.
export async function notificationUnreadCount(_conn: Db | Tx, _userId: string): Promise<number> {
  return 0;
}
