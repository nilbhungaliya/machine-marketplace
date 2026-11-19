import type { Badges, Language, NotificationsPage } from '@mpm/shared-types';
import api from '@/lib/api';

// In-app notifications, the push switch, the server's language and the tab badges (F6 + F7 spec §11, §12.2).

/** `GET /notifications?cursor=`: newest first, text rendered in my language. */
export async function fetchNotifications(cursor?: string | null): Promise<NotificationsPage> {
  const { data } = await api.get<{ data: NotificationsPage }>('/notifications', { params: cursor ? { cursor } : undefined });
  return data.data;
}

/** `POST /notifications/:id/read` → the unread count after. Safe to repeat. */
export async function markNotificationRead(id: string): Promise<{ unreadCount: number }> {
  const { data } = await api.post<{ data: { unreadCount: number } }>(`/notifications/${id}/read`);
  return data.data;
}

/** `POST /notifications/read-all`. */
export async function markAllNotificationsRead(): Promise<{ unreadCount: number }> {
  const { data } = await api.post<{ data: { unreadCount: number } }>('/notifications/read-all');
  return data.data;
}

/** `GET /notifications/preferences`: the one push switch (review change 29). */
export async function fetchPushPreference(): Promise<{ push: boolean }> {
  const { data } = await api.get<{ data: { push: boolean } }>('/notifications/preferences');
  return data.data;
}

export async function savePushPreference(push: boolean): Promise<{ push: boolean }> {
  const { data } = await api.put<{ data: { push: boolean } }>('/notifications/preferences', { push });
  return data.data;
}

/** `PUT /users/me/language`: the list and pushes are rendered in the app's language. */
export async function saveServerLanguage(language: Language): Promise<void> {
  await api.put('/users/me/language', { language });
}

/** `GET /users/me/badges`: unread threads, deals waiting on me, unread notifications. */
export async function fetchBadges(): Promise<Badges> {
  const { data } = await api.get<{ data: Badges }>('/users/me/badges');
  return data.data;
}
