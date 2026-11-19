import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { CHAT_LIMITS } from '@mpm/shared-types';
import { ValidationError } from '../../lib/errors.js';
import { sniffDocument } from '../../lib/sniff-document.js';
import { deleteObject, getObjectBytes, presignPrivateGet, presignSignedPut, putPrivateObject } from '../../lib/storage.js';

/**
 * Private photos on chat messages and deals (F6 + F7 spec §6.8, R8; ported from textile
 * `services/chat/private-photo.ts`). They live only in the private bucket and are read through 300 s signed URLs by the
 * thread's members (and admins under §16.3).
 *
 * Unlike F2's listing photos (refused when they carry EXIF), these are **stripped**: finalising re-encodes the upload to
 * JPEG with `sharp` (no `withMetadata`), which drops EXIF, XMP, IPTC and GPS.
 *
 * 1. `presignPrivatePhoto` signs a PUT to `incoming-chat/<businessId>/<uuid>`.
 * 2. `finalizePrivatePhotos` (before the message / deal transaction) checks each key is this business's upload, reads
 *    it, sniffs JPEG / PNG / WebP, re-encodes, writes `chat/<threadId>/<uuid>.jpg` or `deal/<dealId>/<uuid>.jpg` and
 *    deletes the upload, so a second finalize of the same key is `PHOTO_KEY_INVALID`.
 */

export type PhotoDestination = { kind: 'chat'; threadId: string } | { kind: 'deal'; dealId: string };

const TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** The upload is read while no row lock is held, but it still holds a request open. */
const READ_TIMEOUT_MS = 60_000;
const UPLOAD_TAIL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const photoInvalid = (details?: Record<string, unknown>) =>
  new ValidationError('This photo can’t be used', details, 'PHOTO_INVALID');
const tooMany = () =>
  new ValidationError('Too many photos', { max: CHAT_LIMITS.photosPerMessage }, 'TOO_MANY_PHOTOS');
const keyInvalid = () => new ValidationError('This photo upload is not valid here', undefined, 'PHOTO_KEY_INVALID');

const uploadPrefix = (businessId: string) => `incoming-chat/${businessId}/`;

/** True when `key` is a presigned upload of this business (shape only; the object may be gone). */
export function isOwnPhotoUpload(businessId: string, key: string): boolean {
  const prefix = uploadPrefix(businessId);
  return key.startsWith(prefix) && UPLOAD_TAIL.test(key.slice(prefix.length));
}

export async function presignPrivatePhoto(
  businessId: string,
  contentType: string,
  contentLength: number,
): Promise<{ url: string; key: string; expiresAt: Date }> {
  if (!TYPES.has(contentType)) throw photoInvalid({ contentType });
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > CHAT_LIMITS.photoMaxBytes) {
    throw photoInvalid({ maxBytes: CHAT_LIMITS.photoMaxBytes });
  }
  return presignSignedPut(`${uploadPrefix(businessId)}${randomUUID()}`, contentType, contentLength);
}

/**
 * JPEG, long edge ≤ 2 048 px, quality 80, oriented by its EXIF and then stripped of every piece of metadata (sharp
 * writes none without `withMetadata`). Throws on bytes sharp can't read.
 */
export async function reencodeToJpeg(bytes: Uint8Array): Promise<Buffer> {
  // limitInputPixels: a small file that decodes to a huge image (a decompression bomb) is refused (PHOTO_INVALID).
  return sharp(bytes, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: CHAT_LIMITS.photoMaxEdgePx, height: CHAT_LIMITS.photoMaxEdgePx, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: CHAT_LIMITS.photoJpegQuality })
    .toBuffer();
}

function finalKey(dest: PhotoDestination): string {
  return dest.kind === 'chat' ? `chat/${dest.threadId}/${randomUUID()}.jpg` : `deal/${dest.dealId}/${randomUUID()}.jpg`;
}

async function finalizeOne(key: string, dest: PhotoDestination): Promise<string> {
  const bytes = await getObjectBytes(key, { timeoutMs: READ_TIMEOUT_MS });
  if (bytes === null) throw keyInvalid();
  if (bytes.length === 0 || bytes.length > CHAT_LIMITS.photoMaxBytes) throw photoInvalid({ maxBytes: CHAT_LIMITS.photoMaxBytes });
  const kind = sniffDocument(bytes);
  if (kind !== 'jpg' && kind !== 'png' && kind !== 'webp') throw photoInvalid();
  let jpeg: Buffer;
  try {
    jpeg = await reencodeToJpeg(bytes);
  } catch {
    throw photoInvalid();
  }
  const out = finalKey(dest);
  await putPrivateObject(out, jpeg, 'image/jpeg');
  return out;
}

/**
 * Turns uploads into stored photos and returns their final keys, in order. More than `photosPerMessage` keys answer
 * `400 TOO_MANY_PHOTOS`; every key's shape is checked before any storage call (`400 PHOTO_KEY_INVALID`). Any later
 * failure deletes the finals already written and answers `400 PHOTO_INVALID` (a missing upload: `PHOTO_KEY_INVALID`); storage being down stays `503 STORAGE_UNAVAILABLE`.
 * Uploads are deleted only once every photo is stored.
 */
export async function finalizePrivatePhotos(businessId: string, keys: string[], dest: PhotoDestination): Promise<string[]> {
  if (keys.length > CHAT_LIMITS.photosPerMessage) throw tooMany();
  if (new Set(keys).size !== keys.length) throw keyInvalid();
  for (const key of keys) if (!isOwnPhotoUpload(businessId, key)) throw keyInvalid();

  const finals: string[] = [];
  try {
    for (const key of keys) finals.push(await finalizeOne(key, dest));
  } catch (err) {
    await Promise.allSettled(finals.map((k) => deleteObject(k)));
    throw err;
  }
  await Promise.allSettled(keys.map((k) => deleteObject(k)));
  return finals;
}

/** A 300 s signed URL. Callers check who's asking first. */
export async function privatePhotoUrl(key: string): Promise<{ url: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + CHAT_LIMITS.photoUrlSeconds * 1000).toISOString();
  return { url: await presignPrivateGet(key, CHAT_LIMITS.photoUrlSeconds), expiresAt };
}
