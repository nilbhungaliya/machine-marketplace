import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * Keys that must never leave the device in a crash report: credentials, and the personal data the business and GST
 * bodies carry (F1: GSTIN, PAN, email, names, addresses, the location pin and pincode, codes, the code hint, officer
 * messages). Matched on the whole key, any case.
 */
const SECRET_KEYS = new RegExp(
  '^(' +
    [
      'authorization', 'cookie', 'token', 'refreshtoken', 'password', 'otp', 'code', 'phone', 'firebase_token',
      'phone_token', 'razorpay_signature', 'jwt_token',
      // Not plain `name`: Sentry's own contexts use it (os.name, app name). The person's name only travels in request
      // bodies, which scrubEvent drops whole.
      'gstin', 'pan', 'email', 'username', 'legalname', 'tradename', 'businessname', 'displayname',
      'address', 'addressline', 'gstaddress', 'industrialareaother', 'lat', 'lng', 'latitude', 'longitude', 'pincode',
      'hint', 'officermessage',
    ].join('|') +
    ')$',
  'i',
);

/** A URL without its query string (`?lat=…&lng=…`, a signed upload's `X-Amz-Signature=…`). */
export function stripQuery<T>(url: T): T {
  return (typeof url === 'string' ? url.replace(/\?[^\s#]*/g, '') : url) as T;
}

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
export function scrubEvent(event: any): any {
  if (!event) return event;
  if (event.request) {
    event.request.url = stripQuery(event.request.url);
    event.request.query_string = undefined;
    event.request.headers = redact(event.request.headers);
    event.request.data = undefined;
    event.request.cookies = undefined;
  }
  if (event.extra) event.extra = redact(event.extra);
  if (event.contexts) event.contexts = redact(event.contexts);
  // Sentry attaches the signed-in user; keep the id, drop the rest.
  if (event.user) event.user = { id: event.user.id };
  return event;
}

export function scrubBreadcrumb(crumb: any): any {
  if (!crumb) return crumb;
  // The axios integration puts request headers here, which carries our JWT.
  if (crumb.data) {
    crumb.data = redact(crumb.data);
    for (const key of ['url', 'from', 'to']) {
      if (typeof crumb.data[key] === 'string') crumb.data[key] = stripQuery(crumb.data[key]);
    }
  }
  if (typeof crumb.message === 'string') crumb.message = stripQuery(crumb.message);
  return crumb;
}

/** No-ops without a DSN, so a developer without one runs the app normally. */
export function initErrorReporting(): boolean {
  if (!DSN) return false;
  Sentry.init({
    dsn: DSN,
    // Errors only — tracing is what exhausts the free tier.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  return true;
}

/** Attributes a crash to an account. The id only — never a name or phone. */
export function setErrorUser(userId: string | null): void {
  if (!DSN) return;
  Sentry.setUser(userId ? { id: userId } : null);
}
