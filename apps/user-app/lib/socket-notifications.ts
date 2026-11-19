import type { QueryClient } from '@tanstack/react-query';

/**
 * `/user` socket events for notifications (F6 + F7 spec §13): `notification:new { unreadCount }`. Routed here by
 * `routeSocketEvent` (`hooks/useSocket.ts`); updates `qk.badges` and `qk.notifications`.
 */
// F6F7-STUB(L8): L8-2 updates the bell and the list.
export function handleNotificationEvent(_queryClient: QueryClient, _event: string, _data: unknown): void {
  return;
}
