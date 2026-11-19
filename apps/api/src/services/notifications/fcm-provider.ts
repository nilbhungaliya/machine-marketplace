import type { App } from 'firebase-admin/app';
import type { PushMessage, PushProvider, PushResult } from './push-provider.js';

/**
 * Firebase Cloud Messaging (HTTP v1) through `firebase-admin` (F6 + F7 spec §11.5; ported from textile
 * `services/notifications/fcm-provider.ts`). The service account comes from `FIREBASE_SERVICE_ACCOUNT_B64` (base64 JSON,
 * root `.env`, never committed). The SDK is loaded on first send, so an API without keys never loads it. Android's
 * notification `tag` is the replace key; the channel is the app's `default`.
 */

const APP_NAME = 'mpm-push';

/** The token is gone: the device row is deleted (§11.5). */
const UNREGISTERED = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);
/** Never worth retrying. Anything else (a timeout, a network error, quota) is retried with backoff. */
const FAILED = new Set(['messaging/invalid-recipient', 'messaging/mismatched-credential', 'messaging/sender-id-mismatch']);

export function classifyFcmError(err: unknown): PushResult {
  const code = (err as { errorInfo?: { code?: unknown } })?.errorInfo?.code ?? (err as { code?: unknown })?.code;
  const label = typeof code === 'string' ? code : 'unknown';
  if (UNREGISTERED.has(label)) return { kind: 'unregistered' };
  if (FAILED.has(label)) return { kind: 'failed', error: label };
  return { kind: 'retry', error: label };
}

export function createFcmProvider(serviceAccountJson: string): PushProvider {
  let app: App | null = null;
  const appFor = async (): Promise<App> => {
    const { cert, getApp, initializeApp } = await import('firebase-admin/app');
    try {
      return getApp(APP_NAME);
    } catch {
      return initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) }, APP_NAME);
    }
  };
  return {
    name: 'fcm',
    async send(m: PushMessage): Promise<PushResult> {
      try {
        app ??= await appFor();
        const { getMessaging } = await import('firebase-admin/messaging');
        const data = Object.fromEntries(Object.entries(m.data).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
        const messageId = await getMessaging(app).send({
          token: m.token,
          notification: { title: m.title, body: m.body },
          data,
          android: { priority: 'high', notification: { tag: m.tag, channelId: 'default' } },
        });
        return { kind: 'sent', messageId };
      } catch (err) {
        return classifyFcmError(err);
      }
    },
  };
}
