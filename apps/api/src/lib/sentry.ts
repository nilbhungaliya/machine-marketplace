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
      if (crumb.data) crumb.data = redact(crumb.data);
      return crumb;
    },
  });
  return true;
}

/** Header and body keys that must never leave the server. F6 + F7 §19 adds message / note / review text, numbers, FCM tokens and photo keys. */
const SECRET_KEYS = /^(authorization|cookie|x-api-key|token|refreshtoken|password|otp|phone|firebase_token|phone_token|razorpay_signature|gstin|pan|account_number|ifsc|text|note|notestext|description|replytext|messagetoparties|contactphone|number|fcmtoken|photokeys)$/i;

export function redact(input: unknown): any {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v);
  }
  return out;
}

/** Exported for tests — the scrubbing is the part worth pinning. */
export function scrub<T extends { request?: any; extra?: any; contexts?: any }>(event: T): T {
  if (event.request) {
    event.request.headers = redact(event.request.headers);
    event.request.cookies = undefined;
    event.request.data = undefined;   // bodies never go, whatever dataCollection says
  }
  if (event.extra) event.extra = redact(event.extra);
  if (event.contexts) event.contexts = redact(event.contexts);
  return event;
}

export { Sentry };
