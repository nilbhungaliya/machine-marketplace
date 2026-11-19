import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import * as Application from 'expo-application';
import api from '@/lib/api';
import { i18n } from '@/lib/i18n';
import { getInstallId } from '@/lib/install-id';
import { navigationRef } from '@/navigation/navigationRef';
import { store } from '@/store';
import type { PushAskTrigger } from './push-ask';

/**
 * Push on the phone (F6 + F7 spec §11.5, §11.6; ported from textile `lib/push.ts` + `lib/notifications-module.ts`).
 *
 * Opt-in and harmless without Firebase: Android only (iOS's device token is an APNs token, which the server's FCM sender
 * can't use, so iOS doesn't register yet); `expo-notifications` is loaded only when its native module is in the build
 * (an older dev client keeps running); without a `google-services.json` in the build the token call fails, which is
 * logged (no token, no text) and changes nothing else. Nothing here ever throws to a caller.
 */

export type NotificationsModule = typeof import('expo-notifications');

/** Set once the explainer has been offered on this install (it is offered once, §11.6). */
export const PUSH_EXPLAINER_SHOWN_KEY = 'push.explainer_shown';
/** The channel FCM sends to (`channelId: 'default'` in the API's FCM provider; the plugin's `defaultChannel`). */
export const PUSH_CHANNEL_ID = 'default';

export type PushRegistration = 'registered' | 'denied' | 'unsupported' | 'failed';

let cached: NotificationsModule | null | undefined;

/** `expo-notifications`, or null when this build can't load it (iOS for now, or a dev client built before it). */
export function notificationsModule(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'android') {
    cached = null;
    return cached;
  }
  // Ask for the native module first: requiring the library on a build without it would be a fatal error at start.
  if (requireOptionalNativeModule('ExpoPushTokenManager') === null) {
    console.log('[Push] expo-notifications unavailable in this build');
    cached = null;
    return cached;
  }
  try {
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    console.log('[Push] expo-notifications unavailable in this build');
    cached = null;
  }
  return cached;
}

/** A signed-in user with a business (the device routes need one). */
export function pushSignedIn(): boolean {
  const { isAuthenticated, onboarding } = store.getState().auth;
  return isAuthenticated && onboarding === 'done';
}

/** Android 13 shows its prompt only once a channel exists, so this runs first. Its name is in the language on screen. */
async function ensureChannel(N: NotificationsModule): Promise<void> {
  await N.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    name: i18n.t('notifications.channel'),
    importance: N.AndroidImportance.HIGH,
  });
}

/** `PUT /users/me/devices`: this install takes the token from any other account on the server. */
async function sendToken(fcmToken: string): Promise<void> {
  await api.put('/users/me/devices', {
    installId: await getInstallId(),
    fcmToken,
    platform: 'android',
    appVersion: Application.nativeApplicationVersion ?? null,
  });
}

/** One registration or unregistration at a time, in order (a sign-out never lands after the next sign-in's token). */
let sequence: Promise<unknown> = Promise.resolve();
function inSequence<T>(fn: () => Promise<T>): Promise<T> {
  const next = sequence.then(fn, fn);
  sequence = next.catch(() => undefined);
  return next;
}

/**
 * Permission, the FCM token and the device row. `ask` shows Android's prompt when permission isn't settled yet (only
 * from the explainer or the settings switch); without it this only refreshes a device that already allows
 * notifications (app start, sign-in), so the app never prompts at start.
 */
export function registerForPush({ ask = false }: { ask?: boolean } = {}): Promise<PushRegistration> {
  return inSequence(() => registerNow(ask));
}

async function registerNow(ask: boolean): Promise<PushRegistration> {
  const N = notificationsModule();
  if (!N || !pushSignedIn()) return 'unsupported';
  try {
    await ensureChannel(N);
    let permission = await N.getPermissionsAsync();
    if (!permission.granted && ask && permission.canAskAgain) permission = await N.requestPermissionsAsync();
    if (!permission.granted) return 'denied';
    const token = await N.getDevicePushTokenAsync();
    await sendToken(String(token.data));
    return 'registered';
  } catch (error) {
    // Most often a build without google-services.json (no Firebase). Logged without the token, never shown.
    console.log('[Push] Registration failed:', error instanceof Error ? error.name : 'unknown');
    return 'failed';
  }
}

/** Whether the phone lets this app show notifications: `granted`, `undetermined` (can still ask) or `blocked`. */
export async function pushPermission(): Promise<'granted' | 'undetermined' | 'blocked' | 'unsupported'> {
  const N = notificationsModule();
  if (!N) return 'unsupported';
  try {
    const p = await N.getPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? 'undetermined' : 'blocked';
  } catch {
    return 'unsupported';
  }
}

/** A refreshed token (`addPushTokenListener`, §11.6: token refresh updates the row). */
export async function updatePushToken(fcmToken: string): Promise<void> {
  if (!notificationsModule() || !pushSignedIn()) return;
  try {
    await inSequence(() => sendToken(fcmToken));
  } catch {
    // The next start registers again.
  }
}

/**
 * Sign-out (§11.6): deletes this install's device row with the session's `token` (read before it was cleared), then
 * invalidates the FCM token so a missed delete still stops pushes (the server's next send gets "unregistered" and drops
 * the row). Runs in the background; never holds up signing out.
 */
export function unregisterPush(token: string | null): Promise<void> {
  return inSequence(async () => {
    const N = notificationsModule();
    if (!N) return;
    if (token) {
      try {
        const installId = await getInstallId();
        await api.delete(`/users/me/devices/${encodeURIComponent(installId)}`, {
          timeout: 4000,
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // The token invalidation below covers it.
      }
    }
    try {
      await N.unregisterForNotificationsAsync();
    } catch {
      console.log('[Push] Token invalidation failed');
    }
  });
}

/** What `askPushOnce` reads before deciding (§11.6). */
export async function readPushAskState(): Promise<{ asked: boolean; granted: boolean; canAskAgain: boolean } | null> {
  const N = notificationsModule();
  if (!N || !pushSignedIn()) return null;
  try {
    const asked = (await AsyncStorage.getItem(PUSH_EXPLAINER_SHOWN_KEY)) !== null;
    const p = await N.getPermissionsAsync();
    return { asked, granted: p.granted, canAskAgain: p.canAskAgain };
  } catch {
    return null;
  }
}

export async function markPushAsked(): Promise<void> {
  try {
    await AsyncStorage.setItem(PUSH_EXPLAINER_SHOWN_KEY, '1');
  } catch {
    // Offered again next time: harmless.
  }
}

/** Opens the explainer over the current screen. */
export function openPushExplainer(trigger: PushAskTrigger): void {
  if (navigationRef.isReady()) navigationRef.navigate('PermissionExplainer', { trigger });
}
