import type { Tx } from '../../db/index.js';
import { emitToThreadMembers } from './chat-emit.js';
import { inboxRowFor } from './inbox.service.js';
import type { ThreadRow } from './members.js';
import { toThreadMessages } from './message.service.js';
import type { MessageRow } from './thread-lines.js';

/**
 * `message:new { threadId, message: ThreadMessage, row: InboxRow }` per reader (F6 + F7 spec §13), queued for every
 * active member of both businesses with `emitToThreadMembers`. Called by `insertMessage` for every row it writes (text,
 * photos, enquiry and offer / deal cards, system lines), so L2 / L3 lines reach the apps without knowing the views.
 * Each payload is built for its reader inside the transaction: text masked per reader (a viewer always), the scam
 * warning for the other side only, the inbox row with that reader's unread count and turn.
 */
export async function emitMessageNew(tx: Tx, thread: ThreadRow, row: MessageRow): Promise<void> {
  await emitToThreadMembers(tx, thread, 'message:new', async (reader) => ({
    threadId: thread.id,
    message: (await toThreadMessages(tx, [row], reader, thread))[0],
    row: await inboxRowFor(tx, reader, thread.id),
  }));
}
