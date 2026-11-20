import { eq } from 'drizzle-orm';
import { PART_REQUEST_LIMITS, type PartRequestPhotos } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { partRequests } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { deleteObject } from '../../lib/storage.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { finalizePrivatePhotos, isOwnPhotoUpload, presignPrivatePhoto, privatePhotoUrl } from '../chat/private-photo.js';
import { requestRoleFor } from './eligibility.js';
import { partRequestNotFound } from './locks.js';
import { assertOnboarded } from './request-input.js';

// Reference photos of a request (spec R1, §17): uploaded to `incoming-chat/<businessId>/` (chat's presign), re-encoded
// with `sharp` into the private `part-request/<id>/<uuid>.jpg` keys **before** the write's transaction (storage I/O
// never holds a row lock), read through 300 s signed URLs by the buyer and eligible sellers.

type Conn = Db | Tx;

const keyInvalid = () => new ValidationError('This photo upload is not valid here', undefined, 'PHOTO_KEY_INVALID');

/** `POST /part-requests/photos/presign`: chat's presign under the user's business (`409 ONBOARDING_INCOMPLETE` without one). */
export async function presignRequestPhoto(
  conn: Conn,
  user: UserTokenPayload,
  body: { contentType: string; contentLength: number },
): Promise<{ url: string; key: string; expiresAt: string }> {
  const businessId = await assertOnboarded(conn, user);
  const p = await presignPrivatePhoto(businessId, body.contentType, body.contentLength);
  return { url: p.url, key: p.key, expiresAt: p.expiresAt.toISOString() };
}

/**
 * The photo list a post or an edit stores, from what the client sent: keys already stored on the request are kept in
 * place, this business's uploads are finalised (at most `photosMax` in all, `TOO_MANY_PHOTOS`), anything else is
 * `PHOTO_KEY_INVALID`. Returns the final list, the new final keys (to delete if the write fails) and the stored keys
 * left out (to delete after the write commits).
 */
export async function resolveRequestPhotos(
  businessId: string,
  partRequestId: string,
  sent: string[],
  stored: string[],
): Promise<{ keys: string[]; added: string[]; dropped: string[] }> {
  if (sent.length > PART_REQUEST_LIMITS.photosMax) {
    throw new ValidationError('Too many photos', { max: PART_REQUEST_LIMITS.photosMax }, 'TOO_MANY_PHOTOS');
  }
  if (new Set(sent).size !== sent.length) throw keyInvalid();
  const kept = new Set(stored);
  const uploads = sent.filter((k) => !kept.has(k));
  for (const k of uploads) if (!isOwnPhotoUpload(businessId, k)) throw keyInvalid();
  const finals = uploads.length
    ? await finalizePrivatePhotos(businessId, uploads, { kind: 'part_request', partRequestId }, { max: PART_REQUEST_LIMITS.photosMax })
    : [];
  const byUpload = new Map(uploads.map((k, i) => [k, finals[i]!]));
  return {
    keys: sent.map((k) => byUpload.get(k) ?? k),
    added: finals,
    dropped: stored.filter((k) => !sent.includes(k)),
  };
}

/** Deletes private objects, best-effort (a failure is logged by the caller's logger, never thrown). */
export async function deletePhotoKeys(keys: string[], log?: { warn: (obj: object, msg: string) => void }): Promise<void> {
  if (keys.length === 0) return;
  const results = await Promise.allSettled(keys.map((k) => deleteObject(k)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) log?.warn({ failed }, 'part request photo delete failed');
}

/** `GET /part-requests/:id/photos`: 300 s URLs for the buyer business and eligible sellers; anyone else 404. */
export async function requestPhotoUrls(conn: Conn, user: UserTokenPayload, id: string): Promise<PartRequestPhotos> {
  if (!user.businessId || !(await requestRoleFor(conn, id, user.businessId))) throw partRequestNotFound();
  const [row] = await conn.select({ photoKeys: partRequests.photoKeys }).from(partRequests).where(eq(partRequests.id, id));
  if (!row) throw partRequestNotFound();
  return { photos: await Promise.all(row.photoKeys.map((k) => privatePhotoUrl(k))) };
}
