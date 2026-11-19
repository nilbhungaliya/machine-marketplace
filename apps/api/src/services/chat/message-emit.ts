import type { Tx } from '../../db/index.js';
import type { MessageRow } from './thread-lines.js';
import type { ThreadRow } from './members.js';

/**
 * `message:new { threadId, message: ThreadMessage, row: InboxRow }` per reader (F6 + F7 spec §13), queued for every
 * active member of both businesses with `emitToThreadMembers`. Called by `insertMessage` for every row it writes (text,
 * photos, enquiry and offer / deal cards, system lines), so L2 / L3 lines reach the apps without knowing the views.
 */
// F6F7-STUB(L1): L1-1 builds the per-reader `ThreadMessage` and `InboxRow` here.
export async function emitMessageNew(_tx: Tx, _thread: ThreadRow, _row: MessageRow): Promise<void> {
  return;
}
