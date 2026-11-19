import { useInfiniteQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Badges, NotificationsPage } from '@mpm/shared-types';
import { useOnReconnect } from '@/components/SocketProvider';
import { useMember } from '@/hooks/use-badges';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/notifications-api';
import { qk } from '@/lib/query-keys';

/** The bell's count after a read, without waiting for the badges refetch. */
export function setUnreadCount(qc: QueryClient, unreadCount: number): void {
  qc.setQueryData<Badges>(qk.badges(), (old) => (old ? { ...old, notificationsUnread: unreadCount } : old));
}

/** The notifications list (F6 + F7 spec §11.6): newest first, 20 a page, refetched on reconnect. */
export function useNotificationsList() {
  const member = useMember();
  const query = useInfiniteQuery({
    queryKey: qk.notifications(),
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: NotificationsPage) => last.nextCursor,
    enabled: member,
    staleTime: 0,
  });
  const { refetch } = query;
  useOnReconnect(() => {
    if (member) void refetch();
  });
  return query;
}

/** Marks one row read (a tap opens it), patching the list and the bell at once. */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: (id) => {
      qc.setQueryData<{ pages: NotificationsPage[]; pageParams: unknown[] }>(qk.notifications(), (old) =>
        old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((n) => (n.id === id ? { ...n, read: true } : n)) })) } : old,
      );
    },
    onSuccess: ({ unreadCount }) => setUnreadCount(qc, unreadCount),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.badges() }),
  });
}

/** Mark all as read. */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: ({ unreadCount }) => {
      setUnreadCount(qc, unreadCount);
      qc.setQueryData<{ pages: NotificationsPage[]; pageParams: unknown[] }>(qk.notifications(), (old) =>
        old ? { ...old, pages: old.pages.map((p) => ({ ...p, unreadCount: 0, items: p.items.map((n) => ({ ...n, read: true })) })) } : old,
      );
    },
  });
}
