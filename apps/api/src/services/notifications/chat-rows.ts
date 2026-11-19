import type { Tx } from '../../db/index.js';
import type { ThreadRow } from '../chat/members.js';

/**
 * Grouped chat notifications (F6 + F7 spec §11.2): one unread `message_new` row per user and thread, bumped by each new
 * message (`unread_count`, `last_seq`, `version`). L4-3 owns this file.
 */

// F6F7-STUB(L4): L4-3 implements the grouped row and its deliveries.
export async function upsertChatNotification(
  _tx: Tx,
  _input: { thread: ThreadRow; recipientBusinessId: string; senderBusinessName: string; seq: number },
): Promise<void> {
  return;
}

/** Reading a thread marks that user's grouped row read. */
// F6F7-STUB(L4): L4-3 implements the read.
export async function markChatNotificationRead(_tx: Tx, _userId: string, _threadId: string): Promise<void> {
  return;
}
