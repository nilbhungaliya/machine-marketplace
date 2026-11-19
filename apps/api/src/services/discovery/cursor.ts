import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { discoveryCursorSecret } from '../../env.js';
import { ValidationError } from '../../lib/errors.js';

// Sealed keyset cursors (F4 + F5 spec §5.10, R11, R18): AES-256-GCM under a key derived from DISCOVERY_CURSOR_SECRET,
// base64url. The AAD binds a cursor to its sort and to the hash of the request it came from (origin included), so a
// cursor can't be replayed against another sort, query, filter set or origin. Saved listings use the same seal.

/** A search page's position: the first page's time, the last row's tier, sort key(s) and id. */
export interface CursorPayload {
  asOf: string;
  tier: number;
  key: number | string | null;
  /** `nearest`: the relevance that breaks km ties. */
  key2: number | null;
  id: string;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: { secret: string; key: Buffer } | null = null;

function cursorKey(): Buffer {
  const secret = discoveryCursorSecret();
  if (cachedKey?.secret !== secret) {
    cachedKey = { secret, key: createHash('sha256').update(`mpm:discovery:cursor:v1:${secret}`).digest() };
  }
  return cachedKey.key;
}

export function cursorInvalid(): ValidationError {
  return new ValidationError('This list has changed. Start again from the top.', undefined, 'CURSOR_INVALID');
}

/** Seals any JSON payload under `aad`: base64url(iv ‖ tag ‖ ciphertext). */
export function sealCursor(payload: object, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', cursorKey(), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** Opens a sealed cursor; anything tampered, foreign, malformed or sealed under another AAD is `400 CURSOR_INVALID`. */
export function openCursor<T extends object = CursorPayload>(token: string, aad: string): T {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(token)) throw cursorInvalid();
  const raw = Buffer.from(token, 'base64url');
  if (raw.length <= IV_BYTES + TAG_BYTES) throw cursorInvalid();
  try {
    const decipher = createDecipheriv('aes-256-gcm', cursorKey(), raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as T;
  } catch {
    throw cursorInvalid();
  }
}

/** JSON with object keys sorted at every level and `undefined` members left out. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

/**
 * sha256 (hex) of the canonical JSON of the request without its `cursor`, origin included (R18: the app sends page 1's
 * origin with every later page). Callers pass filters through `cleanFilters()` first.
 */
export function requestHash(request: Record<string, unknown>): string {
  const { cursor: _cursor, ...rest } = request;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

/** The AAD of a search cursor: the sort and the request hash. */
export function cursorAad(sort: string, hash: string): string {
  return `search:${sort}:${hash}`;
}
