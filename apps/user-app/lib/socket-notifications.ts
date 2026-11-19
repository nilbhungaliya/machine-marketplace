import type { QueryClient } from '@tanstack/react-query';
import type { Badges } from '@mpm/shared-types';
import { qk } from './query-keys';

/**
 * `/user` socket events for notifications (F6 + F7 spec §13): `notification:new { unreadCount }`. Routed here by
 * `routeSocketEvent` (`hooks/useSocket.ts`). The bell's count is patched at once; the badges are refetched (a new
 * message or deal event also moves the Chats and Deals counts) and the list is marked stale.
 */
export function handleNotificationEvent(queryClient: QueryClient, event: string, data: unknown): void {
  if (event !== 'notification:new') return;
  const unreadCount = (data as { unreadCount?: unknown } | null)?.unreadCount;
  if (typeof unreadCount === 'number') {
    queryClient.setQueryData<Badges>(qk.badges(), (old) => (old ? { ...old, notificationsUnread: unreadCount } : old));
  }
  void queryClient.invalidateQueries({ queryKey: qk.badges() });
  void queryClient.invalidateQueries({ queryKey: qk.notifications() });
}
