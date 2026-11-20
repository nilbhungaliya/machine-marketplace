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
    /** F8: the part request a row belongs to (the app's `parsePushData` reads it). */
    partRequestId?: string;
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
type Warn = (message: string) => void;

export interface FirebaseServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  [key: string]: unknown;
}

/**
 * The service account from `FIREBASE_SERVICE_ACCOUNT_B64`: base64 of a JSON object with non-empty `project_id`,
 * `client_email` and `private_key`. Null when unset or malformed (the value itself is never logged).
 */
export function parseServiceAccount(env: Env = process.env): FirebaseServiceAccount | null {
  const b64 = env.FIREBASE_SERVICE_ACCOUNT_B64?.trim();
  if (!b64) return null;
  try {
    const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, unknown>;
    const ok = (k: string) => typeof parsed?.[k] === 'string' && (parsed[k] as string).trim() !== '';
    return ok('project_id') && ok('client_email') && ok('private_key') ? (parsed as FirebaseServiceAccount) : null;
  } catch {
    return null;
  }
}

/** Set but unusable: `index.ts` and the provider warn once, and push behaves as without keys. */
export function serviceAccountMalformed(env: Env = process.env): boolean {
  return Boolean(env.FIREBASE_SERVICE_ACCOUNT_B64?.trim()) && parseServiceAccount(env) === null;
}

const noKeys = (env: Env): PushProvider => (env.NODE_ENV === 'production' ? offPushProvider : devPushStub);

/**
 * FCM when `FIREBASE_SERVICE_ACCOUNT_B64` holds a valid service account; else the dev stub outside production, else
 * `off`. A malformed value warns once (`warn`, never the value) and falls back to that no-keys behaviour, so a bad key
 * doesn't fail and retry every push.
 */
export function pushProviderFromEnv(env: Env = process.env, warn: Warn = (m) => console.warn(m)): PushProvider {
  const account = parseServiceAccount(env);
  if (account) return createFcmProvider(account);
  if (serviceAccountMalformed(env)) {
    warn('FIREBASE_SERVICE_ACCOUNT_B64 is not a valid base64 service-account JSON (project_id, client_email, private_key): push treated as unconfigured');
  }
  return noKeys(env);
}

/** True when production can't push (no or malformed credentials): `index.ts` logs one warning at boot. */
export function pushOffInProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production' && parseServiceAccount(env) === null;
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
