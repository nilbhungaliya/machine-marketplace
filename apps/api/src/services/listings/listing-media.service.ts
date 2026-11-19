import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  EDITABLE_LISTING_STATUSES,
  LISTING_PHOTOS_MAX,
  LISTING_VIDEOS_MAX,
  LISTING_VIDEO_MAX_MS,
  MEDIA_MAX_BYTES,
  MEDIA_ROLES_BY_TYPE,
  MEDIA_UPLOAD_CONTENT_TYPES,
  listingTransition,
  type AdminMediaDeleteResult,
  type CdnPurgeResult,
  type ListingMediaItem,
  type ListingStatus,
  type MediaAttachResult,
  type MediaDeleteResult,
  type MediaOrderResult,
  type MediaPresignResult,
  type MediaRole,
  type MediaType,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listingMedia, listings } from '../../db/schema.js';
import { adminText } from '../../lib/admin-text.js';
import { purgeUrls } from '../../lib/cdn-purge.js';
import { AppError, ConflictError, PayloadTooLargeError, ValidationError } from '../../lib/errors.js';
import { publicUrl } from '../../lib/media-url.js';
import { videoUploadEnabled } from '../../lib/media-switch.js';
import { Sentry } from '../../lib/sentry.js';
import { runTx, type TxApp } from '../../lib/tx-effects.js';
import { MEDIA_SNIFF_BYTES, jpegHeaderStatus, sniffMedia, type SniffedMedia } from '../../lib/sniff-media.js';
import {
  ObjectMissingError,
  PreconditionFailedError,
  copyToPublic,
  deleteObject,
  deletePublicObject,
  getObjectBytes,
  headObject,
  isMediaStorageConfigured,
  isSafeKey,
  presignSignedPut,
  requireMediaStorage,
} from '../../lib/storage.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { writeAudit } from '../audit.service.js';
import { afterListingStatusWrite } from '../deals/holds.js';
import { mediaOptional } from './listing-gate.service.js';
import { applySystemTransition } from './listing-lifecycle.service.js';
import { listingNotFound, lockBusinessThenListing, type ListingRow } from './locks.js';

// Listing media (F2 spec §6, plan Tasks 13 and 16): the private-incoming → public-bucket pipeline, reorder, seller and
// admin delete. Uploads land in the private bucket under `incoming-listing/<businessId>/<listingId>/<uploadId>/<uuid>.<ext>`
// (as F1's `incoming-verification/`); attach checks them (key shape, size, sniffed type, no EXIF) and copies them to the
// public bucket under `listings/<listingId>/<mediaId>/<role>.<ext>`. The database stores public keys only.
//
// Every media endpoint answers `503 STORAGE_UNAVAILABLE` without the media variables (§6.1). Clean-up after a commit
// (incoming objects, deleted public objects, CDN purge) is best-effort: logged and reported, never thrown.

type Log = { error: (obj: unknown, msg?: string) => void };
const consoleLog: Log = { error: (obj, msg) => console.error(msg, obj) };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);
const INCOMING_FILE_RE = new RegExp(`^${UUID}\\.(jpg|mp4|mov)$`);

/** The extension a presigned upload's key gets from the content type it is signed with (the sniff decides later). */
const EXT_OF_CONTENT_TYPE: Record<string, 'jpg' | 'mp4' | 'mov'> = {
  'image/jpeg': 'jpg',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

const MEDIA_MAX: Record<MediaType, number> = { photo: LISTING_PHOTOS_MAX, video: LISTING_VIDEOS_MAX };

function mediaType(message = 'Upload a JPEG photo or an MP4 / MOV video'): ValidationError {
  return new ValidationError(message, undefined, 'MEDIA_TYPE');
}

function mediaLimit(type: MediaType): ConflictError {
  return new ConflictError(
    type === 'photo' ? `A listing can have up to ${LISTING_PHOTOS_MAX} photos` : `A listing can have up to ${LISTING_VIDEOS_MAX} videos`,
    'MEDIA_LIMIT',
    { type, max: MEDIA_MAX[type] },
  );
}

function tooLarge(role: MediaRole): PayloadTooLargeError {
  return new PayloadTooLargeError('The file is too large', 'MEDIA_TOO_LARGE', { role, maxBytes: MEDIA_MAX_BYTES[role] });
}

function mediaMissing(role: MediaRole): ValidationError {
  return new ValidationError('An upload is missing. Upload it again.', { role }, 'MEDIA_MISSING');
}

function keyInvalid(): ValidationError {
  return new ValidationError('Media must be your own uploads for this listing', undefined, 'MEDIA_KEY_INVALID');
}

function notEditable(): ConflictError {
  return new ConflictError("This listing can't be edited now", 'LISTING_NOT_EDITABLE');
}

function mediaNotFound(): AppError {
  return new AppError('Photo or video not found', 404, 'MEDIA_NOT_FOUND');
}

const isEditable = (status: ListingStatus) => (EDITABLE_LISTING_STATUSES as readonly ListingStatus[]).includes(status);

/** The API shape of a stored item (URLs built at read time, null without `MEDIA_PUBLIC_BASE_URL`). */
export function toMediaItem(m: typeof listingMedia.$inferSelect): ListingMediaItem {
  return {
    id: m.id,
    type: m.type,
    url: publicUrl(m.key),
    thumbUrl: publicUrl(m.thumbKey),
    contentType: m.contentType,
    sizeBytes: m.sizeBytes,
    durationMs: m.durationMs,
    sortOrder: m.sortOrder,
  };
}

/** The caller's listing, unlocked (presign and the pre-checks of attach): `404` when it isn't theirs. */
async function ownListing(conn: Db | Tx, user: UserTokenPayload, listingId: string): Promise<ListingRow> {
  if (!user.businessId) throw listingNotFound();
  const [row] = await conn
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.businessId, user.businessId)));
  if (!row) throw listingNotFound();
  return row;
}

async function countOf(conn: Db | Tx, listingId: string, type: MediaType): Promise<number> {
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(listingMedia)
    .where(and(eq(listingMedia.listingId, listingId), eq(listingMedia.type, type)));
  return row?.n ?? 0;
}

/** The listing changed: `version + 1`, and `refreshed_at` for a seller's edit of a non-draft listing (§6.2, §7.3). */
async function bumpListing(tx: Tx, listing: ListingRow, refresh: boolean): Promise<ListingRow> {
  const [row] = await tx
    .update(listings)
    .set({
      version: sql`${listings.version} + 1`,
      updatedAt: sql`now()`,
      ...(refresh && listing.status !== 'draft' ? { refreshedAt: sql`now()` } : {}),
    })
    .where(eq(listings.id, listing.id))
    .returning();
  return row!;
}

function report(log: Log, msg: string, obj: Record<string, unknown>, err: unknown): void {
  log.error({ ...obj, err: err instanceof Error ? err.message : String(err) }, msg);
  Sentry.captureException(err, { tags: { media: 'cleanup' } });
}

/** Deletes private (incoming) objects; failures logged, never thrown. Leftovers go with the 1-day lifecycle rule. */
async function deleteIncoming(keys: string[], log: Log): Promise<void> {
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch (err) {
      report(log, 'storage: could not delete an incoming upload', { key }, err);
    }
  }
}

/** Deletes public copies made for an attach that didn't commit; failures logged, never thrown. */
async function deletePublicCopies(keys: string[], log: Log): Promise<void> {
  for (const key of keys) {
    try {
      await deletePublicObject(key);
    } catch (err) {
      report(log, 'storage: could not delete a public copy', { key }, err);
    }
  }
}

/**
 * After a commit that deleted media rows (seller delete, admin delete, draft delete, §6.1 R45): delete the public
 * objects, then purge their URLs from the CDN. Best-effort: skipped (`'skipped'`) when media storage isn't configured;
 * each failure logged and reported, never thrown. Returns the purge result.
 */
export async function removePublicMedia(keys: string[], log: Log = consoleLog): Promise<CdnPurgeResult> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return 'skipped';
  if (!isMediaStorageConfigured()) return 'skipped';
  await deletePublicCopies(unique, log);
  try {
    return await purgeUrls(unique.map((k) => publicUrl(k)).filter((u): u is string => u !== null), { log });
  } catch (err) {
    // purgeUrls never throws; kept so a bug there can't fail a committed delete.
    report(log, 'cdn: purge threw', { count: unique.length }, err);
    return 'failed';
  }
}

// ─── Presign ───

export interface PresignMediaInput {
  type: MediaType;
  uploadId?: string;
  files: Array<{ role: MediaRole; contentType: string; size: number }>;
}

/**
 * `POST /listings/:id/media/presign` (§6.2 step 1): signed PUTs (300 s, `Content-Type` and `Content-Length` signed) for
 * one item's two files. Storage configured (`503`); video on (`400 MEDIA_TYPE`); exactly the type's two roles with an
 * accepted content type (`400 MEDIA_TYPE`) and a size within the role's cap (`413 MEDIA_TOO_LARGE`); the caller's
 * editable listing (`404`, `409 LISTING_NOT_EDITABLE`); room for one more (`409 MEDIA_LIMIT`). The same `uploadId` may
 * be presigned again (a retry); each call signs fresh keys under it.
 */
export async function presignMedia(
  db: Db | Tx,
  user: UserTokenPayload,
  listingId: string,
  input: PresignMediaInput,
): Promise<MediaPresignResult> {
  requireMediaStorage();
  if (input.type === 'video' && !videoUploadEnabled()) throw mediaType("Video upload isn't available yet");
  const roles = MEDIA_ROLES_BY_TYPE[input.type];
  const sent = input.files.map((f) => f.role);
  if (sent.length !== roles.length || !roles.every((r) => sent.includes(r))) {
    throw new ValidationError(`A ${input.type} uploads ${roles.join(' and ')}`, { roles: [...roles] });
  }
  for (const f of input.files) {
    if (!MEDIA_UPLOAD_CONTENT_TYPES[f.role].includes(f.contentType)) throw mediaType();
    if (!Number.isSafeInteger(f.size) || f.size <= 0) throw new ValidationError('Invalid file size');
    if (f.size > MEDIA_MAX_BYTES[f.role]) throw tooLarge(f.role);
  }
  if (input.uploadId !== undefined && !UUID_RE.test(input.uploadId)) throw new ValidationError('Invalid upload id');

  const listing = await ownListing(db, user, listingId);
  if (!isEditable(listing.status)) throw notEditable();
  if ((await countOf(db, listingId, input.type)) >= MEDIA_MAX[input.type]) throw mediaLimit(input.type);

  const uploadId = input.uploadId ?? randomUUID();
  const files: MediaPresignResult['files'] = [];
  for (const f of input.files) {
    const key = `incoming-listing/${listing.businessId}/${listingId}/${uploadId}/${randomUUID()}.${EXT_OF_CONTENT_TYPE[f.contentType]}`;
    const put = await presignSignedPut(key, f.contentType, f.size);
    files.push({ role: f.role, key: put.key, url: put.url, expiresAt: put.expiresAt.toISOString() });
  }
  return { uploadId, files };
}

// ─── Attach ───

export interface AttachMediaInput {
  type: MediaType;
  uploadId: string;
  keys: Partial<Record<MediaRole, string>>;
  durationMs?: number;
}

interface CheckedFile {
  role: MediaRole;
  incomingKey: string;
  size: number;
  sniffed: SniffedMedia;
  /** HEAD's ETag: the range read and the copy are conditional on it, so only the checked bytes go public. */
  etag: string | null;
}

/**
 * Head, size, sniff and metadata check of one incoming file (§6.2 step 3, §6.3, §6.4). A presigned PUT can be
 * replayed for its 300 s, so the range read is conditional on HEAD's ETag (and the copy later too): bytes changed in
 * between → `400 MEDIA_MISSING`, and the app uploads again.
 */
async function checkIncoming(role: MediaRole, key: string): Promise<CheckedFile> {
  let head: Awaited<ReturnType<typeof headObject>>;
  try {
    head = await headObject(key);
  } catch (err) {
    if (err instanceof ObjectMissingError) throw mediaMissing(role);
    throw err;
  }
  if (!head) throw mediaMissing(role);
  if (head.contentLength > MEDIA_MAX_BYTES[role]) throw tooLarge(role);
  if (head.contentLength <= 0) throw mediaType();
  let first: Buffer | null;
  try {
    first = await getObjectBytes(key, {
      range: { start: 0, end: MEDIA_SNIFF_BYTES - 1 },
      ...(head.etag ? { ifMatch: head.etag } : {}),
    });
  } catch (err) {
    if (err instanceof PreconditionFailedError) throw mediaMissing(role);
    throw err;
  }
  if (first === null) throw mediaMissing(role);
  const sniffed = sniffMedia(first, role);
  if (!sniffed) throw mediaType();
  if (sniffed.ext === 'jpg') {
    const header = jpegHeaderStatus(first);
    // `exif` and `metadata` (XMP, IPTC, JUMBF / C2PA… R46); `incomplete`: the header didn't end in the first 64 KB (or
    // is broken), so neither can be ruled out: refused too.
    if (header !== 'clean') {
      throw new ValidationError('This photo still carries its camera data. Take or pick it again in the app.', { role }, 'MEDIA_METADATA');
    }
  }
  return { role, incomingKey: key, size: head.contentLength, sniffed, etag: head.etag };
}

/**
 * `POST /listings/:id/media` (§6.2 step 3), in this order, before any transaction: storage (`503`); the video switch
 * (`400 MEDIA_TYPE`); a video's `durationMs` present and ≤ 60 500 (`400 VIDEO_TOO_LONG`); every key one of ours for
 * this business, listing and `uploadId` (`400 MEDIA_KEY_INVALID`) — those three never touch storage —; the listing
 * the caller's (`404`), editable (`409`) with room (`409 MEDIA_LIMIT`); then head (`400 MEDIA_MISSING`,
 * `413 MEDIA_TOO_LARGE`), the first 64 KB sniffed (`400 MEDIA_TYPE`) and checked for EXIF (`400 MEDIA_METADATA`); the
 * copies to the public bucket. Then one transaction: business → listing locks, editable and the count again (two
 * concurrent attaches serialise on the business lock: the loser gets `409 MEDIA_LIMIT`), the row at the next
 * `sort_order`, `version + 1`, `refreshed_at` for a non-draft. After commit the incoming objects are deleted; if the
 * transaction (or a copy) fails, the public copies are deleted. Returns the item (201).
 */
export async function attachMedia(
  db: Db,
  user: UserTokenPayload,
  listingId: string,
  input: AttachMediaInput,
  log: Log = consoleLog,
): Promise<MediaAttachResult> {
  requireMediaStorage();
  if (!user.businessId) throw listingNotFound();
  if (input.type === 'video' && !videoUploadEnabled()) throw mediaType("Video upload isn't available yet");
  if (input.type === 'video') {
    const ms = input.durationMs;
    if (ms === undefined || !Number.isSafeInteger(ms) || ms <= 0 || ms > LISTING_VIDEO_MAX_MS) {
      throw new ValidationError('Videos can be up to 60 seconds', { maxMs: LISTING_VIDEO_MAX_MS }, 'VIDEO_TOO_LONG');
    }
  }

  const roles = MEDIA_ROLES_BY_TYPE[input.type];
  const prefix = `incoming-listing/${user.businessId}/${listingId}/${input.uploadId}/`;
  const sentRoles = Object.keys(input.keys);
  const keys = roles.map((r) => input.keys[r]);
  if (
    !UUID_RE.test(input.uploadId) ||
    sentRoles.length !== roles.length ||
    keys.some((k) => typeof k !== 'string' || !k.startsWith(prefix) || !INCOMING_FILE_RE.test(k.slice(prefix.length)) || !isSafeKey(k)) ||
    new Set(keys).size !== keys.length
  ) {
    throw keyInvalid();
  }

  const pre = await ownListing(db, user, listingId);
  if (!isEditable(pre.status)) throw notEditable();
  if ((await countOf(db, listingId, input.type)) >= MEDIA_MAX[input.type]) throw mediaLimit(input.type);

  const checked: CheckedFile[] = [];
  for (const role of roles) checked.push(await checkIncoming(role, input.keys[role]!));

  const mediaId = randomUUID();
  const publicKeys: string[] = [];
  try {
    for (const file of checked) {
      const target = `listings/${listingId}/${mediaId}/${file.role}.${file.sniffed.ext}`;
      try {
        await copyToPublic(file.incomingKey, target, {
          contentType: file.sniffed.contentType,
          ...(file.etag ? { ifMatch: file.etag } : {}),
        });
      } catch (err) {
        if (err instanceof ObjectMissingError || err instanceof PreconditionFailedError) throw mediaMissing(file.role);
        throw err;
      }
      publicKeys.push(target);
    }
  } catch (err) {
    await deletePublicCopies(publicKeys, log);
    throw err;
  }

  const [primary, secondary] = checked as [CheckedFile, CheckedFile];
  let row: typeof listingMedia.$inferSelect;
  try {
    row = await db.transaction(async (tx) => {
      const { listing } = await lockBusinessThenListing(tx, user.businessId!, listingId);
      if (!isEditable(listing.status)) throw notEditable();
      if ((await countOf(tx, listingId, input.type)) >= MEDIA_MAX[input.type]) throw mediaLimit(input.type);
      const [last] = await tx
        .select({ max: sql<number | null>`max(${listingMedia.sortOrder})` })
        .from(listingMedia)
        .where(eq(listingMedia.listingId, listingId));
      const [inserted] = await tx
        .insert(listingMedia)
        .values({
          id: mediaId,
          listingId,
          type: input.type,
          key: publicKeys[0]!,
          thumbKey: publicKeys[1]!,
          contentType: primary.sniffed.contentType,
          sizeBytes: primary.size,
          durationMs: input.type === 'video' ? input.durationMs! : null,
          sortOrder: (last?.max ?? -1) + 1,
        })
        .returning();
      await bumpListing(tx, listing, true);
      return inserted!;
    });
  } catch (err) {
    await deletePublicCopies(publicKeys, log);
    throw err;
  }

  await deleteIncoming([primary.incomingKey, secondary.incomingKey], log);
  return toMediaItem(row);
}

// ─── Reorder ───

/**
 * `PUT /listings/:id/media/order { ids }` (§6.2 step 4): the full list of the listing's media ids in their new order
 * (the first photo is the cover); any other set → `400 MEDIA_ORDER_INVALID`. Under the business → listing locks;
 * editable (`409`); `version + 1`, `refreshed_at` for a non-draft. Returns the media in the new order.
 */
export async function reorderMedia(tx: Tx, user: UserTokenPayload, listingId: string, ids: string[]): Promise<MediaOrderResult> {
  requireMediaStorage();
  if (!user.businessId) throw listingNotFound();
  const { listing } = await lockBusinessThenListing(tx, user.businessId, listingId);
  if (!isEditable(listing.status)) throw notEditable();
  const rows = await tx.select({ id: listingMedia.id }).from(listingMedia).where(eq(listingMedia.listingId, listingId));
  const current = new Set(rows.map((r) => r.id));
  if (ids.length !== current.size || new Set(ids).size !== ids.length || !ids.every((id) => current.has(id))) {
    throw new ValidationError("Send every photo and video of this listing, once each", undefined, 'MEDIA_ORDER_INVALID');
  }
  for (const [i, id] of ids.entries()) {
    await tx.update(listingMedia).set({ sortOrder: i }).where(and(eq(listingMedia.id, id), eq(listingMedia.listingId, listingId)));
  }
  await bumpListing(tx, listing, true);
  const ordered = await tx
    .select()
    .from(listingMedia)
    .where(eq(listingMedia.listingId, listingId))
    .orderBy(asc(listingMedia.sortOrder), asc(listingMedia.createdAt));
  return ordered.map(toMediaItem);
}

// ─── Seller delete ───

/**
 * `DELETE /listings/:id/media/:mediaId` (§6.2 step 5): under the business → listing locks; editable (`409`); the item
 * this listing's (`404 MEDIA_NOT_FOUND`); not the last photo of a non-draft listing (`409 MEDIA_LAST_PHOTO`, unless
 * the dev switch, R31). The row goes, `version + 1`, `refreshed_at` for a non-draft; after commit the public objects
 * are deleted and their URLs purged (best-effort).
 */
export async function deleteMedia(
  db: Db,
  user: UserTokenPayload,
  listingId: string,
  mediaId: string,
  log: Log = consoleLog,
): Promise<MediaDeleteResult> {
  requireMediaStorage();
  if (!user.businessId) throw listingNotFound();
  const removed = await db.transaction(async (tx) => {
    const { listing } = await lockBusinessThenListing(tx, user.businessId!, listingId);
    if (!isEditable(listing.status)) throw notEditable();
    const [item] = await tx
      .select()
      .from(listingMedia)
      .where(and(eq(listingMedia.id, mediaId), eq(listingMedia.listingId, listingId)));
    if (!item) throw mediaNotFound();
    if (item.type === 'photo' && listing.status !== 'draft' && !mediaOptional() && (await countOf(tx, listingId, 'photo')) <= 1) {
      throw new ConflictError('A listing needs at least one photo. Add another before deleting this one.', 'MEDIA_LAST_PHOTO');
    }
    await tx.delete(listingMedia).where(eq(listingMedia.id, item.id));
    await bumpListing(tx, listing, true);
    return item;
  });
  await removePublicMedia([removed.key, removed.thumbKey ?? ''], log);
  return { id: removed.id, deleted: true };
}

// ─── Admin delete (plan Task 16, §11.3) ───

/**
 * `DELETE /admin/listings/:id/media/:mediaId { reason }` (§11.3): for abusive media, whatever the listing's status and
 * version (R53). Reason 3–500 characters (`400`). Under the business → listing locks: the row goes, `version + 1`
 * (a moderator's stale approve then fails); **the last photo of a listing on its public side** (`live`, `paused`,
 * `expired`, `unavailable`, `sold`, `rented`) moves it to `rejected` (`photos_removed`, outcome `changes_requested`,
 * the reason as the note, R52); a `hidden` or `pending_review` one keeps its status (approve and unhide refuse it
 * without a photo, amendment 2). One `listing_media.delete` audit row. After commit the objects are deleted and the URLs
 * purged; the response carries the purge result. F6 + F7 §22: runs through `runTx`, and a `photos_removed` move is
 * followed by `afterListingStatusWrite` (open offers reconciled).
 */
export async function adminDeleteMedia(
  app: TxApp,
  adminId: string,
  listingId: string,
  mediaId: string,
  reasonText: string,
  log: Log = consoleLog,
): Promise<AdminMediaDeleteResult> {
  const reason = adminText(reasonText, 'reason');
  requireMediaStorage();
  const removed = await runTx(app, async (tx) => {
    const [found] = await tx.select({ businessId: listings.businessId }).from(listings).where(eq(listings.id, listingId));
    if (!found) throw listingNotFound();
    const { listing } = await lockBusinessThenListing(tx, found.businessId, listingId);
    const [item] = await tx
      .select()
      .from(listingMedia)
      .where(and(eq(listingMedia.id, mediaId), eq(listingMedia.listingId, listingId)));
    if (!item) throw mediaNotFound();

    await tx.delete(listingMedia).where(eq(listingMedia.id, item.id));
    let after = await bumpListing(tx, listing, false);
    const lastPhoto = item.type === 'photo' && (await countOf(tx, listingId, 'photo')) === 0;
    if (lastPhoto && listingTransition(after.status, 'photos_removed', after.kind, 'system')) {
      after = await applySystemTransition(tx, after, 'photos_removed', { reason, adminId });
      after = await afterListingStatusWrite(tx, listingId);
    }
    await writeAudit(tx, {
      adminId,
      action: 'listing_media.delete',
      entityType: 'listing',
      entityId: listingId,
      before: { media: { id: item.id, type: item.type, key: item.key, thumbKey: item.thumbKey }, status: listing.status, version: listing.version },
      after: { status: after.status, version: after.version, reason },
    });
    return item;
  });
  const purge = await removePublicMedia([removed.key, removed.thumbKey ?? ''], log);
  return { purge };
}
