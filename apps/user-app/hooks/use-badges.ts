import { useQuery } from '@tanstack/react-query';
import { useOnReconnect } from '@/components/SocketProvider';
import { useAuth } from '@/hooks/useAuth';
import { fetchBadges } from '@/lib/notifications-api';
import { qk } from '@/lib/query-keys';

/** A signed-in user with a business: badges, the bell and push need one (the API's onboarding gate). */
export function useMember(): boolean {
  const { isAuthenticated, onboarding } = useAuth();
  return isAuthenticated && onboarding === 'done';
}

/**
 * The tab badges and the bell's count (`GET /users/me/badges`, F6 + F7 spec §15.2): Chats = unread threads, Deals =
 * deals waiting on me, bell = unread notifications. Refetched on focus, after a socket reconnect and on
 * `notification:new` (`lib/socket-notifications.ts`); guests get none.
 */
export function useBadges() {
  const member = useMember();
  const query = useQuery({ queryKey: qk.badges(), queryFn: fetchBadges, enabled: member, staleTime: 15_000 });
  const { refetch } = query;
  useOnReconnect(() => {
    if (member) void refetch();
  });
  return member ? query.data ?? null : null;
}
