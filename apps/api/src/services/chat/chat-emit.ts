import type { Tx } from '../../db/index.js';
import { queueBusinessEmit, queueUserEmit } from '../../lib/tx-effects.js';
import { threadMembers, type ChatReader, type ThreadRow } from './members.js';

/**
 * Socket emits for threads (F6 + F7 spec R10, §13; ported from textile `services/chat/chat-emit.ts`, D2). No thread
 * room: an event carrying text is built for each member and queued to that member's `userRoom`, so a `viewer` never
 * receives an unmasked payload. Everything waits in the transaction's effects queue (`runTx`) until commit.
 */

/** Builds `event`'s payload once per active member of both businesses (inside the transaction) and queues it. */
export async function emitToThreadMembers(
  tx: Tx,
  thread: Pick<ThreadRow, 'buyerBusinessId' | 'sellerBusinessId'>,
  event: string,
  build: (reader: ChatReader) => unknown | Promise<unknown>,
): Promise<void> {
  for (const reader of await threadMembers(tx, thread)) {
    queueUserEmit(tx, reader.userId, event, await build(reader));
  }
}

/** An id-only event (no text, R10) to every socket of each business, e.g. `deal:updated`. */
export function emitToBusinesses(tx: Tx, businessIds: string[], event: string, payload: unknown): void {
  for (const businessId of new Set(businessIds)) queueBusinessEmit(tx, businessId, event, payload);
}
