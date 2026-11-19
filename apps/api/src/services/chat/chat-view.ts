import { maskContact } from '../../lib/mask-contact.js';
import type { ChatReader, ThreadRow } from './members.js';

/**
 * Per-reader text (F6 + F7 spec §6.5, R6; ported from textile `services/chat/chat-view.ts`). `visibleText` is the
 * **only** way user-written text leaves the API for a party: messages, enquiry / offer / reject / deal / handover notes,
 * dispute descriptions shown to the other party, inbox previews and socket payloads. Stored text never changes.
 */

/** Unmasked only once the thread's contact is unlocked (a deal and both ticks, §6.6), and never for a `viewer`. */
export function canSeeContact(thread: Pick<ThreadRow, 'contactUnlockedAt'>, reader: Pick<ChatReader, 'memberRole'>): boolean {
  return thread.contactUnlockedAt !== null && reader.memberRole !== 'viewer';
}

export function visibleText(
  text: string | null,
  reader: Pick<ChatReader, 'memberRole'>,
  thread: Pick<ThreadRow, 'contactUnlockedAt'>,
): string | null {
  if (text === null) return null;
  return canSeeContact(thread, reader) ? text : maskContact(text);
}

/** Listing titles and business names in strips and notifications: user-written and public, so masked always (§6.5). */
export function publicText(text: string | null): string | null {
  return text === null ? null : maskContact(text);
}
