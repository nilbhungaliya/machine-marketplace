import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { InboxFilter, InboxPage, InboxRow, OfferView, ThreadDetail, ThreadMessage } from '@mpm/shared-types';
import {
  addMessageToPages, applyInboxRow, applyOfferUpdate, findRow, markRowRead, yourTurnDelta, type MessagePage,
} from './chat-format';
import { qk } from './query-keys';

/**
 * `/user` socket events for chat (F6 + F7 spec §13): `message:new`, `offer:updated`, `thread:read`, `thread:updated`.
 * Routed here by `routeSocketEvent` (`hooks/useSocket.ts`). Payloads with text are built per reader by the server
 * (masked already), so they are placed in the caches as they come; events with ids only make the screens ask again.
 * Sockets are best-effort: the screens refetch on focus and on reconnect (`useOnReconnect`).
 */

/** The thread on screen and focused (set by the thread screen): its row keeps unread 0, the screen marks it read. */
let openThreadId: string | null = null;
export function setOpenThread(id: string | null): void {
  openThreadId = id;
}
export const getOpenThread = (): string | null => openThreadId;

/** `['threads', filter, archived]` → the list it is, or null for any other key under `['threads']`. */
function listOf(key: readonly unknown[]): { filter: InboxFilter; archived: boolean } | null {
  const [, filter, archived] = key;
  if (typeof filter !== 'string' || typeof archived !== 'boolean') return null;
  return { filter: filter as InboxFilter, archived };
}

/** The row's last known version in any cached inbox list. */
function knownRow(queryClient: QueryClient, threadId: string): InboxRow | undefined {
  for (const [, data] of queryClient.getQueriesData<InfiniteData<InboxPage>>({ queryKey: qk.allThreads })) {
    const row = findRow(data?.pages, threadId);
    if (row) return row;
  }
  return undefined;
}

/** A row from the server placed in every cached inbox list; a thread no list knew makes them ask again. */
export function applyRowToCaches(queryClient: QueryClient, row: InboxRow): void {
  const delta = yourTurnDelta(knownRow(queryClient, row.threadId), row);
  if (delta === null) {
    void queryClient.invalidateQueries({ queryKey: qk.allThreads });
    return;
  }
  for (const [key, data] of queryClient.getQueriesData<InfiniteData<InboxPage>>({ queryKey: qk.allThreads })) {
    const list = listOf(key);
    if (!list || !data) continue;
    queryClient.setQueryData<InfiniteData<InboxPage>>(key, {
      ...data,
      pages: applyInboxRow(data.pages, row, list, delta, openThreadId),
    });
  }
}

/** A message (socket or send reply) placed in the thread's cached pages, once. */
export function applyMessageToCaches(queryClient: QueryClient, message: ThreadMessage): void {
  queryClient.setQueryData<InfiniteData<MessagePage>>(qk.messages(message.threadId), (data) =>
    data ? { ...data, pages: addMessageToPages(data.pages, message) } : data,
  );
  // A card or a system line can mean the negotiation, a deal, the block or the contact state moved on.
  if (message.kind !== 'text' && message.kind !== 'photos') {
    void queryClient.invalidateQueries({ queryKey: qk.thread(message.threadId), exact: true });
  }
}

/** The thread was read (here or on another device): unread 0 in every list, the badge asks again. */
export function applyReadToCaches(queryClient: QueryClient, threadId: string): void {
  for (const [key, data] of queryClient.getQueriesData<InfiniteData<InboxPage>>({ queryKey: qk.allThreads })) {
    if (!listOf(key) || !data) continue;
    queryClient.setQueryData<InfiniteData<InboxPage>>(key, { ...data, pages: markRowRead(data.pages, threadId) });
  }
  queryClient.setQueryData<ThreadDetail>(qk.thread(threadId), (d) => (d ? { ...d, unread: 0 } : d));
  void queryClient.invalidateQueries({ queryKey: qk.badges() });
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const threadIdOf = (data: unknown): string | null =>
  isObject(data) && typeof data.threadId === 'string' ? data.threadId : null;

export function handleChatEvent(queryClient: QueryClient, event: string, data: unknown): void {
  const threadId = threadIdOf(data);
  switch (event) {
    case 'message:new': {
      const payload = data as { message?: ThreadMessage; row?: InboxRow } | null;
      if (!threadId || !payload?.message || !payload.row) {
        void queryClient.invalidateQueries({ queryKey: qk.allThreads });
        return;
      }
      applyMessageToCaches(queryClient, payload.message);
      applyRowToCaches(queryClient, payload.row);
      void queryClient.invalidateQueries({ queryKey: qk.badges() });
      return;
    }
    case 'offer:updated': {
      const offer = (data as { offer?: OfferView } | null)?.offer;
      if (!threadId) return;
      if (offer) {
        queryClient.setQueryData<InfiniteData<MessagePage>>(qk.messages(threadId), (d) =>
          d ? { ...d, pages: applyOfferUpdate(d.pages, offer) } : d,
        );
      }
      // The open negotiation and the turn live on the thread and its row.
      void queryClient.invalidateQueries({ queryKey: qk.thread(threadId), exact: true });
      void queryClient.invalidateQueries({ queryKey: qk.allThreads });
      return;
    }
    case 'thread:read':
      if (threadId) applyReadToCaches(queryClient, threadId);
      return;
    case 'thread:updated':
      // The number reveal (§6.6): old messages now read unmasked, the header may show the number.
      if (!threadId) return;
      void queryClient.invalidateQueries({ queryKey: qk.thread(threadId) });
      void queryClient.invalidateQueries({ queryKey: qk.allThreads });
      return;
    default:
      return;
  }
}
