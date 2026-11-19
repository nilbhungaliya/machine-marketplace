import type { QueryClient } from '@tanstack/react-query';

/**
 * `/user` socket events for chat (F6 + F7 spec §13): `message:*`, `offer:*` and `thread:*` (`message:new`,
 * `offer:updated`, `thread:read`). Routed here by `routeSocketEvent` (`hooks/useSocket.ts`); patches or invalidates the
 * `qk.threads` / `qk.thread` / `qk.messages` entries (`lib/query-keys.ts`).
 */
// F6F7-STUB(L6): L6-1 patches the inbox and the open thread.
export function handleChatEvent(_queryClient: QueryClient, _event: string, _data: unknown): void {
  return;
}
