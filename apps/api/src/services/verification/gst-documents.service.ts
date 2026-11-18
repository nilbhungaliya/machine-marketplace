import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { GstDocumentType } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { gstRepresentativeProofs } from '../../db/schema.js';
import { NotFoundError, PayloadTooLargeError, ValidationError } from '../../lib/errors.js';
import { sniffDocument, type DocumentKind } from '../../lib/sniff-document.js';
import {
  ObjectMissingError,
  PRIVATE_GET_TTL_SECONDS,
  copyObject,
  deleteObject,
  getObjectBytes,
  headObject,
  isSafeKey,
  presignPrivateGet,
  presignSignedPut,
  requireStorage,
} from '../../lib/storage.js';
import type { GstActor } from './gst-instant.service.js';

/**
 * Review documents in the private R2 bucket (F1 + A2 spec §6; textile `lib/storage.ts` + `admin-documents.ts`).
 *
 * Upload flow: `presignDocumentUpload` → the app PUTs to `incoming-verification/<businessId>/<uploadId>/<uuid>.<ext>`
 * → the submit call names the keys → `stageDocuments` checks and copies them to `verification/<businessId>/<proofId>/`.
 * The caller's order (Task 10): generate the proof id → `stageDocuments` (before any transaction) → save the proof
 * with the `copied` keys in a transaction → **on commit** `deleteKeys(incoming)`; **on rollback or error**
 * `deleteKeys(copied keys)` (the incoming files stay for the R2 lifecycle rule: `incoming-verification/`, 1 day).
 * Only `verification/` keys are ever stored.
 */

/** 10 MB per file (spec §6). */
export const DOCUMENT_MAX_BYTES = 10_485_760;

const EXT_OF: Record<string, DocumentKind> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);
const INCOMING_FILE_RE = new RegExp(`^${UUID}\\.(jpg|png|webp|pdf)$`);
const VERIFICATION_KEY_RE = new RegExp(`^verification/${UUID}/${UUID}/${UUID}\\.(jpg|png|webp|pdf)$`);

function documentType(): ValidationError {
  return new ValidationError('Upload a JPEG, PNG, WebP or PDF file', undefined, 'DOCUMENT_TYPE');
}

function tooLarge(): PayloadTooLargeError {
  return new PayloadTooLargeError('The file is larger than 10 MB', 'MEDIA_TOO_LARGE', { maxBytes: DOCUMENT_MAX_BYTES });
}

export interface PresignDocumentInput {
  /** Adding files to a review in `needs_more`: the proof's id is the upload id. */
  proofId?: string;
  /** A later file of a new submission: the upload id the first presign returned, so all its files share one prefix. */
  uploadId?: string;
  contentType: string;
  size: number;
}

/**
 * A signed PUT (300 s) for one document. `503 STORAGE_UNAVAILABLE` first; a type other than JPEG / PNG / WebP / PDF →
 * `400 DOCUMENT_TYPE`; more than 10 MB → `413 MEDIA_TOO_LARGE`. The upload id is the proof's (it must be this
 * business's, else `404`), the one passed back, or a new one the app sends back on submit.
 */
export async function presignDocumentUpload(
  db: Db | Tx,
  actor: GstActor,
  input: PresignDocumentInput,
): Promise<{ url: string; key: string; expiresAt: string; uploadId: string }> {
  requireStorage();
  const ext = EXT_OF[input.contentType];
  if (!ext) throw documentType();
  if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new ValidationError('Invalid file size');
  if (input.size > DOCUMENT_MAX_BYTES) throw tooLarge();
  if (input.proofId && input.uploadId) throw new ValidationError('Send either proofId or uploadId, not both');

  let uploadId: string;
  if (input.proofId) {
    const [proof] = await db
      .select({ id: gstRepresentativeProofs.id })
      .from(gstRepresentativeProofs)
      .where(and(eq(gstRepresentativeProofs.id, input.proofId), eq(gstRepresentativeProofs.businessId, actor.businessId)));
    if (!proof) throw new NotFoundError('GST review');
    uploadId = proof.id;
  } else if (input.uploadId) {
    if (!UUID_RE.test(input.uploadId)) throw new ValidationError('Invalid upload id');
    uploadId = input.uploadId;
  } else {
    uploadId = randomUUID();
  }

  const key = `incoming-verification/${actor.businessId}/${uploadId}/${randomUUID()}.${ext}`;
  const put = await presignSignedPut(key, input.contentType, input.size);
  return { url: put.url, key: put.key, expiresAt: put.expiresAt.toISOString(), uploadId };
}

export interface StagedDocuments {
  copied: Array<{ key: string; type: GstDocumentType }>;
  incoming: string[];
}

/**
 * Checks the uploaded files and copies them to `verification/<businessId>/<proofId>/<uuid>.<ext>`. **Runs before the
 * database transaction opens.** Every key must be one of ours under `incoming-verification/<businessId>/<uploadId>/`
 * (`400 DOCUMENT_KEY_INVALID`, checked for all files before storage is touched); each object must exist
 * (`400 DOCUMENT_MISSING`), be ≤ 10 MB (`413 MEDIA_TOO_LARGE`) and sniff as JPEG / PNG / WebP / PDF from its first 16
 * bytes (`400 DOCUMENT_TYPE`; the copy's extension follows the sniffed type, not the name). If any file fails, the
 * copies already made are deleted before the error is thrown.
 */
export async function stageDocuments(input: {
  businessId: string;
  uploadId: string;
  proofId: string;
  files: Array<{ key: string; type: GstDocumentType }>;
}): Promise<StagedDocuments> {
  const prefix = `incoming-verification/${input.businessId}/${input.uploadId}/`;
  const keys = input.files.map((f) => f.key);
  const invalid = keys.filter(
    (key) => !key.startsWith(prefix) || !INCOMING_FILE_RE.test(key.slice(prefix.length)) || !isSafeKey(key),
  );
  if (invalid.length > 0 || new Set(keys).size !== keys.length || !UUID_RE.test(input.proofId)) {
    throw new ValidationError('Documents must be your own uploads', { keys: invalid }, 'DOCUMENT_KEY_INVALID');
  }
  requireStorage();

  const copied: StagedDocuments['copied'] = [];
  try {
    for (const file of input.files) {
      const head = await headObject(file.key);
      if (!head) throw new ValidationError('A document upload is missing. Upload it again.', { key: file.key }, 'DOCUMENT_MISSING');
      if (head.contentLength > DOCUMENT_MAX_BYTES) throw tooLarge();
      const first = await getObjectBytes(file.key, { range: { start: 0, end: 15 } });
      if (first === null) throw new ValidationError('A document upload is missing. Upload it again.', { key: file.key }, 'DOCUMENT_MISSING');
      const kind = sniffDocument(first);
      if (kind === null) throw documentType();
      const target = `verification/${input.businessId}/${input.proofId}/${randomUUID()}.${kind}`;
      try {
        await copyObject(file.key, target);
      } catch (err) {
        if (err instanceof ObjectMissingError) {
          throw new ValidationError('A document upload is missing. Upload it again.', { key: file.key }, 'DOCUMENT_MISSING');
        }
        throw err;
      }
      copied.push({ key: target, type: file.type });
    }
  } catch (err) {
    await deleteKeys(copied.map((c) => c.key));
    throw err;
  }
  return { copied, incoming: keys };
}

/** Deletes objects one by one. A failure is logged and never thrown: cleanup must not fail the request it follows. */
export async function deleteKeys(
  keys: string[],
  log: { error: (obj: unknown, msg?: string) => void } = { error: (obj, msg) => console.error(msg, obj) },
): Promise<void> {
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch (err) {
      log.error({ key, err: err instanceof Error ? err.message : String(err) }, 'storage: could not delete an object');
    }
  }
}

/** A 300 s presigned GET for a stored document (officers only, audited by the caller). Only `verification/` keys. */
export async function presignDocumentRead(key: string): Promise<string> {
  requireStorage();
  if (!VERIFICATION_KEY_RE.test(key)) throw new ValidationError('Invalid document key', undefined, 'DOCUMENT_KEY_INVALID');
  return presignPrivateGet(key, PRIVATE_GET_TTL_SECONDS);
}
