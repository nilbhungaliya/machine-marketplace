import * as Sentry from '@sentry/node';

/**
 * Error reporting.
 *
 * Must be initialised before Fastify is constructed — Sentry patches the http
 * module and misses anything created before it runs, which is why this is
 * imported at the very top of index.ts rather than registered as a plugin.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Errors only. Tracing is what exhausts the free tier, and we have no
    // performance question that needs answering yet.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // v10 collects user info and request bodies by default. This API carries
    // phone numbers, GSTINs, bank details and Razorpay payloads.
    dataCollection: { userInfo: false, httpBodies: [] },
    beforeSend: scrub,
    beforeBreadcrumb: (crumb) => {
      if (crumb.data) crumb.data = redact(crumb.data, { url: crumb.data.url });
      return crumb;
    },
  });
  return true;
}

/**
 * Header and body keys that must never leave the server. F6 + F7 §19 adds message / note / review text, numbers, FCM
 * tokens and photo keys; F8 §17 adds a reply's `message`. M14 (plan C0-4, spec §18) adds a booking's `siteAddress`,
 * `damageNote`, `cancelNote` and `finalAmountNote`, and (C0 review M4) `sitePincode` and the `onSite` / `return` /
 * `problem` `PhotoKeys` (anchored: `photokeys` alone misses them); its `message`, `note` and `notesText` are already here.
 */
const SECRET_KEYS = /^(authorization|cookie|x-api-key|token|refreshtoken|password|otp|phone|firebase_token|phone_token|razorpay_signature|gstin|pan|account_number|ifsc|text|note|notestext|description|replytext|messagetoparties|contactphone|number|fcmtoken|photokeys|message|siteaddress|sitepincode|onsitephotokeys|returnphotokeys|problemphotokeys|damagenote|cancelnote|finalamountnote)$/i;

/**
 * F8 §17: a request's `name` is the buyer's free text, so it goes from **request bodies of `/part-requests` routes**
 * only, not through the global list (other events keep their names: business, category, file names).
 */
const PART_REQUEST_BODY_KEYS = /^name$/i;
const PART_REQUEST_PATH = /^(?:[a-z]+:\/\/[^/]+)?\/(?:admin\/)?part-requests(?:[/?#]|$)/i;

/** Whether `url` (a path or a full URL) is a `/part-requests` or `/admin/part-requests` route. */
export function isPartRequestUrl(url: unknown): boolean {
  return typeof url === 'string' && PART_REQUEST_PATH.test(url);
}

/** Redacts secret keys at any depth; with `{ url }` of a `/part-requests` route, also `name` (a request body). */
export function redact(input: unknown, opts: { url?: string } = {}): any {
  const partRequest = isPartRequestUrl(opts.url);
  const walk = (value: unknown): any => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(walk);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) || (partRequest && PART_REQUEST_BODY_KEYS.test(k)) ? '[redacted]' : walk(v);
    }
    return out;
  };
  return walk(input);
}

/** Exported for tests — the scrubbing is the part worth pinning. */
export function scrub<T extends { request?: any; extra?: any; contexts?: any }>(event: T): T {
  if (event.request) {
    event.request.headers = redact(event.request.headers);
    event.request.cookies = undefined;
    event.request.data = undefined;   // bodies never go, whatever dataCollection says
  }
  const url: string | undefined = event.request?.url;
  if (event.extra) event.extra = redact(event.extra, { url });
  if (event.contexts) event.contexts = redact(event.contexts, { url });
  return event;
}

export { Sentry };
