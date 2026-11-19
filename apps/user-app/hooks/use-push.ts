import { useEffect, useRef } from 'react';
import type * as N from 'expo-notifications';
import { useMember } from '@/hooks/use-badges';
import { track } from '@/lib/analytics';
import { NOTIFICATION_EVENTS } from '@/lib/analytics-events';
import { useLanguage } from '@/lib/i18n/language';
import { isPushForOpenThread, notificationLink, parsePushData, type NotificationRoute, type PushData } from '@/lib/notification-links';
import { markNotificationRead, saveServerLanguage } from '@/lib/notifications-api';
import { notificationsModule, pushSignedIn, registerForPush, updatePushToken } from '@/lib/push';
import { shouldShowPush } from '@/lib/push-dedupe';
import { qk } from '@/lib/query-keys';
import { queryClient } from '@/lib/queryClient';
import { navigationRef } from '@/navigation/navigationRef';

/**
 * A tap on a push Android showed carries the data in `content.data`; in the foreground `expo-notifications` fills
 * `content.data` only from an Expo-style body, so the keys are read from the Firebase message on the trigger (textile).
 */
function readPush(request: N.NotificationRequest): PushData | null {
  const trigger = request.trigger as { remoteMessage?: { data?: unknown } } | null;
  return parsePushData(request.content.data) ?? parsePushData(trigger?.remoteMessage?.data);
}

const HIDE = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false } as const;
const SHOW = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false } as const;

/**
 * Foreground (§11.5): the app decides. Not ours, or signed out → hidden. The bell and the list move either way. A chat
 * push for the thread on screen is hidden; otherwise it shows only if its delivery key is new (a retried send repeats
 * its key, a grouped chat row's update has a new version).
 */
async function handleForeground(notification: N.Notification): Promise<N.NotificationBehavior> {
  if (!pushSignedIn()) return HIDE;
  const push = readPush(notification.request);
  if (!push) return HIDE;
  void queryClient.invalidateQueries({ queryKey: qk.notifications() });
  void queryClient.invalidateQueries({ queryKey: qk.badges() });
  const route = navigationRef.isReady() ? navigationRef.getCurrentRoute() : undefined;
  if (isPushForOpenThread(push, route)) return HIDE;
  return (await shouldShowPush(push.deliveryKey)) ? SHOW : HIDE;
}

let handlerSet = false;
function setForegroundHandler(): void {
  const Notifications = notificationsModule();
  if (handlerSet || !Notifications) return;
  handlerSet = true;
  Notifications.setNotificationHandler({ handleNotification: handleForeground });
}

/** A cold start's tap arrives before the navigator exists: wait for it (up to 15 s), then give up quietly. */
function whenNavigationReady(run: () => void, waitedMs = 0): void {
  if (navigationRef.isReady()) {
    run();
    return;
  }
  if (waitedMs >= 15_000) return;
  setTimeout(() => whenNavigationReady(run, waitedMs + 150), 150);
}

/** Opens a notification's screen; the screen checks access as usual. */
export function openNotificationRoute(route: NotificationRoute | null): void {
  if (!route || !navigationRef.isReady()) return;
  // The union's names and params pair up in `notificationLink`; React Navigation can't see that through the union.
  (navigationRef.navigate as (name: string, params?: object) => void)(route.name, route.params);
}

/** Reading is safe to repeat, so a duplicate tap does no harm. */
function markOpenedRead(notificationId: string): void {
  void markNotificationRead(notificationId)
    .catch(() => undefined)
    .finally(() => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications() });
      void queryClient.invalidateQueries({ queryKey: qk.badges() });
    });
}

/**
 * Mounted once (`App.tsx`, inside the navigation container). Signed in with a business:
 * - keeps the server's language in step with the app (`PUT /users/me/language`: the list and pushes follow it);
 * - refreshes this phone's device row when notifications are already allowed (never prompts: the explainer does that
 *   at the moment of intent, `lib/push-ask.ts`), and on a new FCM token;
 * - shows foreground pushes once (dedupe by `deliveryKey`), and opens a tapped push's screen, marking it read.
 * Without the native module (iOS for now, an older dev client) only the language sync runs.
 */
export function usePushNotifications(): void {
  const member = useMember();
  const language = useLanguage();
  const lastOpened = useRef<string | null>(null);

  setForegroundHandler();

  useEffect(() => {
    if (!member) return;
    void saveServerLanguage(language).catch(() => undefined);
  }, [member, language]);

  useEffect(() => {
    const Notifications = notificationsModule();
    if (!member || !Notifications) return undefined;
    void registerForPush();
    const sub = Notifications.addPushTokenListener((token) => {
      void updatePushToken(String(token.data));
    });
    return () => sub.remove();
  }, [member]);

  useEffect(() => {
    const Notifications = notificationsModule();
    if (!Notifications || !member) return undefined;
    const onResponse = (response: N.NotificationResponse | null) => {
      if (!response) return;
      // Handled once: a later read of the last response (a remount, the next start) mustn't open it again.
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const push = readPush(response.notification.request);
      if (!push || lastOpened.current === push.deliveryKey) return;
      lastOpened.current = push.deliveryKey;
      track(NOTIFICATION_EVENTS.notificationOpened, { type: push.type });
      markOpenedRead(push.notificationId);
      whenNavigationReady(() => openNotificationRoute(notificationLink(push)));
    };
    void Notifications.getLastNotificationResponseAsync().then(onResponse).catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(onResponse);
    return () => sub.remove();
  }, [member]);
}

/** Renders nothing: mounts `usePushNotifications` where the providers it needs exist. */
export function PushBridge(): null {
  usePushNotifications();
  return null;
}
