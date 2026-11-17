import PostHog from 'posthog-react-native';

const TOKEN = process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

/** Primitives only — an object here could smuggle PII into an event property. */
export type EventProperties = Record<string, string | number | boolean | null | undefined>;

/**
 * Pinned to globalThis, not a module variable. Metro's Fast Refresh
 * re-evaluates this module on every save; a module variable would build a second
 * client that keeps its own session id, splitting one visit across sessions.
 */
const store = globalThis as typeof globalThis & { __mpmPostHog?: PostHog };

let lastScreen: string | null = null;

/** Returns null with no token, which makes every function below a no-op. */
export function initAnalytics(): PostHog | null {
  if (store.__mpmPostHog) return store.__mpmPostHog;
  if (!TOKEN) return null;
  const created = new PostHog(TOKEN, {
    host: HOST,
    captureAppLifecycleEvents: true,
    persistence: 'file',
    // Session replay off until there's a privacy review: chats and offers carry
    // business terms and, before acceptance, soft-masked contact details.
    enableSessionReplay: false,
  });
  store.__mpmPostHog = created;
  return created;
}

/** Drops undefined keys so an optional property is absent, not null, in PostHog. */
function clean(properties?: EventProperties): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(properties ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function track(event: string, properties?: EventProperties): void {
  store.__mpmPostHog?.capture(event, clean(properties));
}

export function screen(name: string, properties?: EventProperties): void {
  // Params are part of the key so two different listings are two screen views.
  const key = `${name}|${JSON.stringify(properties ?? {})}`;
  if (key === lastScreen) return;
  lastScreen = key;
  store.__mpmPostHog?.screen(name, clean(properties));
}

/** The user id only — names and phones are not sent (scope: DPDP, masked phones). */
export function identifyUser(userId: string): void {
  store.__mpmPostHog?.identify(userId, { mpm_user_id: userId });
}

export function setPersonProperties(set: EventProperties): void {
  store.__mpmPostHog?.setPersonProperties(clean(set), undefined, false);
}

/** On logout. Without it the next person on this device inherits the profile. */
export function resetAnalytics(): void {
  lastScreen = null;
  store.__mpmPostHog?.reset();
}

export { AUTH_EVENTS, pickAllowedParams } from './analytics-events';
