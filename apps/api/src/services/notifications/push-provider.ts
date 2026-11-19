import { createFcmProvider } from './fcm-provider.js';

/**
 * The push sending layer (F6 + F7 spec §11.5; ported from textile `services/notifications/push-provider.ts`). One send
 * per delivery row; the provider never decides retries, `push-sender.ts` does. Opt-in like Sentry: without
 * `FIREBASE_SERVICE_ACCOUNT_B64` nothing leaves the server.
 */
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Android notification `tag`: `thread:<id>` for chat, else the notification id, so a repeat or update replaces it. */
  tag: string;
  /** FCM data values are strings. Ids only: never text. */
  data: {
    notificationId: string;
    type: string;
    /** `<notificationId>:<version>`: the same for a retried send, new for a real update (the app drops a repeat). */
    deliveryKey: string;
    tag: string;
    threadId?: string;
    offerId?: string;
    dealId?: string;
    reviewId?: string;
  };
}

export type PushResult =
  | { kind: 'sent'; messageId: string }
  | { kind: 'sent_dev' }
  /** Production without credentials: nothing can be sent; the in-app row still exists. */
  | { kind: 'skipped' }
  /** The token is gone (FCM `unregistered` / `invalid-argument`): the device row is deleted. */
  | { kind: 'unregistered' }
  /** Worth another try later (backoff 15 s / 1 min / 5 min / 30 min, then `failed`). */
  | { kind: 'retry'; error: string }
  | { kind: 'failed'; error: string };

export interface PushProvider {
  readonly name: 'fcm' | 'dev' | 'off';
  send(m: PushMessage): Promise<PushResult>;
}

/** Without credentials outside production: the row records `sent_dev`; the sender logs ids only. */
export const devPushStub: PushProvider = { name: 'dev', send: async () => ({ kind: 'sent_dev' }) };

/** Production without credentials: every delivery `skipped` (a missing key must not stop chat, §11.5). */
export const offPushProvider: PushProvider = { name: 'off', send: async () => ({ kind: 'skipped' }) };

type Env = Record<string, string | undefined>;

/** FCM when `FIREBASE_SERVICE_ACCOUNT_B64` is set, else the dev stub outside production, else `off`. */
export function pushProviderFromEnv(env: Env = process.env): PushProvider {
  const b64 = env.FIREBASE_SERVICE_ACCOUNT_B64?.trim();
  if (b64) return createFcmProvider(Buffer.from(b64, 'base64').toString('utf8'));
  return env.NODE_ENV === 'production' ? offPushProvider : devPushStub;
}

/** True when production runs without push credentials: `index.ts` logs one warning at boot. */
export function pushOffInProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production' && !env.FIREBASE_SERVICE_ACCOUNT_B64?.trim();
}

let provider: PushProvider | null = null;

export function getPushProvider(): PushProvider {
  provider ??= pushProviderFromEnv();
  return provider;
}

/** Tests: inject a provider (null = back to the default). */
export function setPushProvider(p: PushProvider | null): void {
  provider = p;
}
