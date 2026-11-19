import type { Db, Tx } from '../../db/index.js';
import type { UserTokenPayload } from '../../plugins/auth.js';

/**
 * The Chats inbox (F6 + F7 spec §6.10, R9). L1-3 owns this file.
 */

/** Threads with unread messages for this user (the Chats tab badge). */
// F6F7-STUB(L1): L1-3 implements the inbox and this count.
export async function unreadThreadCount(_conn: Db | Tx, _user: UserTokenPayload): Promise<number> {
  return 0;
}
