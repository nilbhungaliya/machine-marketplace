import fp from 'fastify-plugin';
import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ValidationError } from '../lib/errors.js';
import { Sentry } from '../lib/sentry.js';
import { IdempotencyKeyReusedError, readStoredResponse } from '../services/idempotency.service.js';

/**
 * `Idempotency-Key` request side (F6 + F7 plan P11, C0-3; ported from textile `plugins/idempotency.ts`). A route opts
 * in with `config: { idempotent: true }` and its handler runs through `runIdempotent`. For those routes this plugin
 * appends one preHandler **after** the route's own (auth first: the scope is the signed-in user) that
 * - reads the optional header (a UUID; malformed → `400 VALIDATION_ERROR`; absent → no dedupe, P11),
 * - builds the context: scope `${routeId}:${userId}` (admins: `${routeId}:admin:${adminId}`), where routeId is
 *   `<METHOD> <route pattern>`, and a sha256 of method, pattern, params, query and body (key order ignored),
 * - replays a stored response at once (fast path; `runIdempotent` re-checks under the key's lock), so a replay never
 *   touches storage or the rate limits after it.
 * A guard turns a 2xx from an idempotent route that had a key but never stored its response into a 500.
 *
 * Registered after auth and before every route (its `onRoute` hook only sees routes added after it).
 */

export interface IdempotencyContext {
  scope: string;
  key: string;
  requestHash: string;
  /** Set by `runIdempotent`. */
  applied: boolean;
  /** True when the fast path replied with a stored response. */
  replayed: boolean;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** F6 + F7 **I** routes (§12.2): the handler runs through `runIdempotent`. */
    idempotent?: boolean;
  }
  interface FastifyRequest {
    idempotency?: IdempotencyContext | null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** JSON with object keys sorted, so `{ a, b }` and `{ b, a }` hash the same. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

const routeIdOf = (request: FastifyRequest): string => `${request.method} ${request.routeOptions.url ?? request.url}`;

export function requestHashOf(request: FastifyRequest): string {
  const canonical = canonicalJson({
    route: routeIdOf(request),
    params: request.params ?? {},
    query: request.query ?? {},
    body: request.body ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function scopeOf(request: FastifyRequest): string {
  if (request.user) return `${routeIdOf(request)}:${request.user.userId}`;
  if (request.admin) return `${routeIdOf(request)}:admin:${request.admin.adminId}`;
  // A route wiring bug, not a client error: the auth preHandler must run first.
  throw new Error(`idempotent route ${routeIdOf(request)} must run requireUser / requireAdmin first`);
}

/** Builds (once) and returns the request's context; null when the request carries no key. */
export function idempotencyContextOf(request: FastifyRequest): IdempotencyContext | null {
  if (request.idempotency !== undefined) return request.idempotency;
  const header = request.headers['idempotency-key'];
  if (header === undefined) return (request.idempotency = null);
  const key = Array.isArray(header) ? '' : header.trim();
  if (!UUID.test(key)) throw new ValidationError('Idempotency-Key must be a UUID');
  return (request.idempotency = {
    scope: scopeOf(request),
    key: key.toLowerCase(),
    requestHash: requestHashOf(request),
    applied: false,
    replayed: false,
  });
}

/**
 * Sends the stored response for the request's key and returns true; false when the request has no key or nothing is
 * stored (another request hash → `422 IDEMPOTENCY_KEY_REUSED`). The preHandler's fast path; a route that does work
 * before `runIdempotent` (F8 post / edit) also calls it when that work fails, since a first use that committed in the
 * meantime (an in-flight retry) explains the refusal.
 */
export async function replayStoredResponse(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const ctx = idempotencyContextOf(request);
  if (!ctx) return false;
  const stored = await readStoredResponse(request.server.db, ctx.scope, ctx.key);
  if (!stored) return false;
  if (stored.requestHash !== ctx.requestHash) throw new IdempotencyKeyReusedError();
  ctx.replayed = true;
  void reply.code(stored.status).header('Idempotent-Replay', 'true').send(stored.body);
  return true;
}

const replayPreHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  if (await replayStoredResponse(request, reply)) return reply;
};

export default fp(async (fastify) => {
  fastify.addHook('onRoute', (route) => {
    if (!route.config?.idempotent) return;
    const own = route.preHandler === undefined ? [] : Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler];
    route.preHandler = [...own, replayPreHandler as preHandlerHookHandler];
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    if (!request.routeOptions.config?.idempotent || reply.statusCode >= 400) return payload;
    const ctx = request.idempotency;
    if (!ctx || ctx.applied || ctx.replayed) return payload;
    const route = routeIdOf(request);
    request.log.error({ route, status: reply.statusCode }, 'idempotent route replied without storing its response');
    Sentry.captureMessage('IDEMPOTENCY_NOT_APPLIED', { level: 'error', tags: { route } });
    reply.code(500).header('content-type', 'application/json; charset=utf-8');
    return JSON.stringify({ error: 'Internal server error', code: 'IDEMPOTENCY_NOT_APPLIED' });
  });
});
