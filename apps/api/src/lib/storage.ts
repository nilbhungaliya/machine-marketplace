import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { ServiceUnavailableError, ValidationError } from './errors.js';

/**
 * Private file storage on Cloudflare R2 (S3-compatible; F1 + A2 spec §6), ported from textile's `lib/storage.ts`.
 * **R2 only**: no MinIO, no local fallback. The private bucket (`AWS_S3_PRIVATE_BUCKET`) holds verification documents
 * (read through presigned GETs) and every incoming upload; the public bucket (`AWS_S3_PUBLIC_BUCKET`, F2 §6.1) holds
 * checked listing media.
 *
 * Every key is built by the server. Clients never send a key or a URL we didn't hand them.
 */

/** Presigned PUT and GET lifetime (spec §6: 5 minutes). */
export const UPLOAD_URL_TTL_SECONDS = 300;
export const PRIVATE_GET_TTL_SECONDS = 300;
const MAX_PRESIGN_TTL_SECONDS = 604800; // SigV4 hard cap (7 days)
const DELETE_TIMEOUT_MS = 10_000;
const HEAD_OBJECT_TIMEOUT_MS = 30_000;
/** A server-side copy moves no bytes through here. */
const COPY_TIMEOUT_MS = 120_000;
const CONNECTION_TIMEOUT_MS = 10_000;
/** No byte either way for this long: a half-open connection. A transfer that's moving never trips it. */
const SOCKET_IDLE_TIMEOUT_MS = 60_000;
/** A whole read, the SDK's retries included. */
const TRANSFER_TIMEOUT_MS = 600_000;

/** The five variables that make storage "configured" (spec §6). */
export const STORAGE_ENV = [
  'AWS_S3_ENDPOINT',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_S3_PRIVATE_BUCKET',
] as const;

/** True when all five storage variables are set (non-blank). Read on every call, so tests can clear and restore them. */
export function isStorageConfigured(): boolean {
  return STORAGE_ENV.every((name) => (process.env[name] ?? '').trim() !== '');
}

/** `503 STORAGE_UNAVAILABLE` unless storage is configured. */
export function requireStorage(): void {
  if (!isStorageConfigured()) throw new ServiceUnavailableError('Document upload isn\'t available yet', 'STORAGE_UNAVAILABLE');
}

function privateBucket(): string {
  return process.env.AWS_S3_PRIVATE_BUCKET!.trim();
}

// One client per connection settings: rebuilt only when endpoint, region or credentials change (tests that clear or
// restore the env get a fresh one). The bucket name isn't part of the client, so it's read per call.
let cachedClient: { signature: string; client: S3Client } | undefined;

function buildClient(): S3Client {
  const signature = JSON.stringify([
    process.env.AWS_S3_ENDPOINT,
    process.env.AWS_REGION,
    process.env.AWS_ACCESS_KEY_ID,
    process.env.AWS_SECRET_ACCESS_KEY,
  ]);
  if (cachedClient?.signature === signature) return cachedClient.client;
  // The old client isn't destroyed: a request may still be in flight on it.
  const client = new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    // SDK v3 (>=3.729) adds a default CRC32 checksum; on a presigned PUT it is computed over an EMPTY body and baked
    // into the URL, so a client uploading real bytes fails the checksum. Only add one when the operation requires it.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    endpoint: process.env.AWS_S3_ENDPOINT!,
    forcePathStyle: true,
    requestHandler: { connectionTimeout: CONNECTION_TIMEOUT_MS, socketTimeout: SOCKET_IDLE_TIMEOUT_MS },
  });
  cachedClient = { signature, client };
  return client;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * A per-character check is not enough: `SAFE_SEGMENT` matches `.` and `..`, the SDK signs those dots unencoded, and
 * the HTTP client then normalises the path, so `incoming/a/../../x` would land somewhere other than the key we return.
 * Hence the segment check (empty segments, from `a//b`, fail `SAFE_SEGMENT`).
 */
export function isSafeKey(key: string): boolean {
  return key.split('/').every((segment) => SAFE_SEGMENT.test(segment) && segment !== '.' && segment !== '..');
}

function assertSafeKey(key: string): void {
  if (!isSafeKey(key)) throw new ValidationError('Invalid storage key');
}

function assertContentLength(contentLength: number): void {
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) throw new ValidationError('Invalid content length');
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  // A HEAD on a missing key is a bare 404 with no body: `NotFound` or `NoSuchKey`, depending on the provider.
  return e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchKey';
}

/** An `If-Match` / `x-amz-copy-source-if-match` condition failed: the object changed since its ETag was read. */
function isPreconditionFailed(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.$metadata?.httpStatusCode === 412 || e?.name === 'PreconditionFailed';
}

/**
 * The object's bytes changed after they were checked (its ETag no longer matches). A presigned PUT can be replayed for
 * its 300 s, so the listing media path reads and copies only the version it checked; the caller asks for a new upload.
 */
export class PreconditionFailedError extends Error {
  constructor(public readonly key: string) {
    super('The object changed since it was checked');
    this.name = 'PreconditionFailedError';
  }
}

/** R2 couldn't be reached or answered with a 5xx: the client may retry. A 4xx (a bug or a bad credential) is re-thrown. */
function rethrowStorageError(err: unknown): never {
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  if (status === undefined || status >= 500) throw new ServiceUnavailableError('File storage is unreachable', 'STORAGE_UNAVAILABLE');
  throw err;
}

/**
 * Presigned PUT into the private bucket that signs `Content-Type` and `Content-Length`: the client must send exactly
 * those values.
 */
export async function presignSignedPut(
  key: string,
  contentType: string,
  contentLength: number,
  ttlSeconds: number = UPLOAD_URL_TTL_SECONDS,
): Promise<{ url: string; key: string; expiresAt: Date }> {
  requireStorage();
  assertSafeKey(key);
  assertContentLength(contentLength);
  const expiresIn = Math.min(Math.max(1, Math.floor(ttlSeconds)), MAX_PRESIGN_TTL_SECONDS);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const url = await getSignedUrl(
    buildClient(),
    new PutObjectCommand({ Bucket: privateBucket(), Key: key, ContentType: contentType, ContentLength: contentLength }),
    { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
  );
  return { url, key, expiresAt };
}

/**
 * A short-lived GET for a private object (default 300 s). Local signing (no network). `contentType` and
 * `disposition` are signed into the URL as `response-content-type` / `response-content-disposition`, so the response
 * carries them whatever the object was uploaded with.
 */
export async function presignPrivateGet(
  key: string,
  ttlSeconds = PRIVATE_GET_TTL_SECONDS,
  opts: { contentType?: string; disposition?: string } = {},
): Promise<string> {
  requireStorage();
  assertSafeKey(key);
  const expiresIn = Math.min(Math.max(1, Math.floor(ttlSeconds)), MAX_PRESIGN_TTL_SECONDS);
  return getSignedUrl(
    buildClient(),
    new GetObjectCommand({
      Bucket: privateBucket(),
      Key: key,
      ...(opts.contentType ? { ResponseContentType: opts.contentType } : {}),
      ...(opts.disposition ? { ResponseContentDisposition: opts.disposition } : {}),
    }),
    { expiresIn },
  );
}

/**
 * The SDK's socket timeout ends once the headers are in, so a body that stalls needs its own. A watchdog rather than
 * a socket timeout: on this path the SDK may hand back its checksum stream, which has no socket.
 */
async function readToEnd(body: Readable): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const watchdog = setTimeout(() => body.destroy(new Error('the object stopped arriving')), SOCKET_IDLE_TIMEOUT_MS);
  try {
    for await (const chunk of body) {
      chunks.push(chunk as Uint8Array);
      watchdog.refresh();
    }
  } finally {
    clearTimeout(watchdog);
  }
  return Buffer.concat(chunks);
}

/**
 * The object's bytes, or null if it does not exist. `range` (inclusive byte offsets, e.g. `{ start: 0, end: 15 }`)
 * reads only that part: enough to sniff a type without pulling a 10 MB file through the API.
 */
export async function getObjectBytes(
  key: string,
  opts: { range?: { start: number; end: number }; timeoutMs?: number; ifMatch?: string } = {},
): Promise<Buffer | null> {
  requireStorage();
  assertSafeKey(key);
  try {
    const out = await buildClient().send(
      new GetObjectCommand({
        Bucket: privateBucket(),
        Key: key,
        ...(opts.range ? { Range: `bytes=${opts.range.start}-${opts.range.end}` } : {}),
        ...(opts.ifMatch ? { IfMatch: opts.ifMatch } : {}),
      }),
      { abortSignal: AbortSignal.timeout(opts.timeoutMs ?? TRANSFER_TIMEOUT_MS) },
    );
    if (!out.Body) return Buffer.alloc(0);
    return await readToEnd(out.Body as unknown as Readable);
  } catch (err) {
    if (isNotFound(err)) return null;
    if (isPreconditionFailed(err)) throw new PreconditionFailedError(key);
    // A range starting past the end of an empty object: there are no bytes, not an error.
    if ((err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode === 416) return Buffer.alloc(0);
    rethrowStorageError(err);
  }
}

/**
 * Headers only. Null means not there; anything else is re-thrown ("does not exist" and "could not find out" are
 * different answers). Uploads sign `Content-Type`, but the bytes still need sniffing before they are trusted.
 */
export async function headObject(
  key: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ contentLength: number; contentType: string | null; etag: string | null } | null> {
  requireStorage();
  assertSafeKey(key);
  try {
    const out = await buildClient().send(new HeadObjectCommand({ Bucket: privateBucket(), Key: key }), {
      abortSignal: AbortSignal.timeout(opts.timeoutMs ?? HEAD_OBJECT_TIMEOUT_MS),
    });
    return { contentLength: out.ContentLength ?? 0, contentType: out.ContentType ?? null, etag: out.ETag ?? null };
  } catch (err) {
    if (isNotFound(err)) return null;
    rethrowStorageError(err);
  }
}

/** A copy found nothing at its source. Unlike a storage failure this is an answer, and the caller may know what it means. */
export class ObjectMissingError extends Error {
  constructor(public readonly key: string) {
    super('The object to copy does not exist');
    this.name = 'ObjectMissingError';
  }
}

/** A server-side copy inside the private bucket; the object keeps its headers. `ObjectMissingError` when the source isn't there. */
export async function copyObject(fromKey: string, toKey: string): Promise<void> {
  requireStorage();
  assertSafeKey(fromKey);
  assertSafeKey(toKey);
  const bucket = privateBucket();
  try {
    await buildClient().send(
      // Both names are safe as they stand: the bucket comes from our config and `assertSafeKey` passed the key.
      new CopyObjectCommand({ Bucket: bucket, Key: toKey, CopySource: `${bucket}/${fromKey}` }),
      { abortSignal: AbortSignal.timeout(COPY_TIMEOUT_MS) },
    );
  } catch (err) {
    if (isNotFound(err)) throw new ObjectMissingError(fromKey);
    rethrowStorageError(err);
  }
}

// ─── Public listing media (F2 spec §6.1, §6.6, R45) ───
// Uploads land in the private bucket (`incoming-listing/…`); only sniffed, checked files are copied to the public bucket
// (`listings/<listingId>/<mediaId>/<role>.<ext>`), read through `MEDIA_PUBLIC_BASE_URL` (`lib/media-url.ts`).

/**
 * What listing media needs (§6.1): the five private variables, the public bucket and its base URL; in production also
 * the Cloudflare zone and token, because a production that can't purge can't take media down (R45).
 */
export const MEDIA_STORAGE_ENV = [...STORAGE_ENV, 'AWS_S3_PUBLIC_BUCKET', 'MEDIA_PUBLIC_BASE_URL'] as const;
export const MEDIA_STORAGE_PRODUCTION_ENV = ['CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_API_TOKEN'] as const;

/** Devices and browsers keep a copy for a day, the Cloudflare edge for a year; keys are never reused (R45). */
export const PUBLIC_MEDIA_CACHE_CONTROL = 'public, max-age=86400, s-maxage=31536000';

const isSet = (name: string): boolean => (process.env[name] ?? '').trim() !== '';

/** True when listing media can be stored and served (§6.1). Read on every call, so tests can clear and restore it. */
export function isMediaStorageConfigured(): boolean {
  if (!MEDIA_STORAGE_ENV.every(isSet)) return false;
  return process.env.NODE_ENV !== 'production' || MEDIA_STORAGE_PRODUCTION_ENV.every(isSet);
}

/** `503 STORAGE_UNAVAILABLE` unless listing media storage is configured (every media endpoint, §6.1). */
export function requireMediaStorage(): void {
  if (!isMediaStorageConfigured()) throw new ServiceUnavailableError("Photo upload isn't available yet", 'STORAGE_UNAVAILABLE');
}

function publicBucket(): string {
  return process.env.AWS_S3_PUBLIC_BUCKET!.trim();
}

/**
 * A server-side copy from the private bucket to the public one (R2 CopyObject across buckets of one account: no bytes
 * pass through the API). `MetadataDirective: 'REPLACE'` so the copy carries the **sniffed** `Content-Type` and the
 * public `Cache-Control`, not what the upload was signed with. `ObjectMissingError` when the source isn't there.
 */
export async function copyToPublic(
  fromPrivateKey: string,
  toPublicKey: string,
  opts: { contentType: string; cacheControl?: string; ifMatch?: string },
): Promise<void> {
  requireMediaStorage();
  assertSafeKey(fromPrivateKey);
  assertSafeKey(toPublicKey);
  try {
    await buildClient().send(
      new CopyObjectCommand({
        Bucket: publicBucket(),
        Key: toPublicKey,
        CopySource: `${privateBucket()}/${fromPrivateKey}`,
        MetadataDirective: 'REPLACE',
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl ?? PUBLIC_MEDIA_CACHE_CONTROL,
        ...(opts.ifMatch ? { CopySourceIfMatch: opts.ifMatch } : {}),
      }),
      { abortSignal: AbortSignal.timeout(COPY_TIMEOUT_MS) },
    );
  } catch (err) {
    if (isNotFound(err)) throw new ObjectMissingError(fromPrivateKey);
    if (isPreconditionFailed(err)) throw new PreconditionFailedError(fromPrivateKey);
    rethrowStorageError(err);
  }
}

/** Deletes one object from the public bucket (a no-op for a key that isn't there). The caller purges its CDN URL. */
export async function deletePublicObject(key: string, opts: { timeoutMs?: number } = {}): Promise<void> {
  requireMediaStorage();
  assertSafeKey(key);
  await buildClient()
    .send(new DeleteObjectCommand({ Bucket: publicBucket(), Key: key }), {
      abortSignal: AbortSignal.timeout(opts.timeoutMs ?? DELETE_TIMEOUT_MS),
    })
    .catch(rethrowStorageError);
}

/** Writes bytes the server made (F6 + F7 §6.8: a re-encoded chat or deal photo) to the private bucket. */
export async function putPrivateObject(key: string, body: Buffer, contentType: string): Promise<void> {
  requireStorage();
  assertSafeKey(key);
  await buildClient()
    .send(new PutObjectCommand({ Bucket: privateBucket(), Key: key, Body: body, ContentType: contentType, ContentLength: body.length }), {
      abortSignal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
    })
    .catch(rethrowStorageError);
}

/** Deletes one object. S3/R2 answer 204 for a key that was never there, so a re-run is a no-op. */
export async function deleteObject(key: string, opts: { timeoutMs?: number } = {}): Promise<void> {
  requireStorage();
  assertSafeKey(key);
  await buildClient()
    .send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key }), {
      abortSignal: AbortSignal.timeout(opts.timeoutMs ?? DELETE_TIMEOUT_MS),
    })
    .catch(rethrowStorageError);
}
