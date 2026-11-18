import { GST_DECLARATION_VERSION, type ApiSuccess, type GstDocumentType, type GstStateView } from '@mpm/shared-types';
import api from './api';

// GST verification calls (F1 spec §10): `apps/api/src/routes/gst.ts`. Every call returns the business's new
// `GstStateView`, which callers put in the React Query cache.

// The review sends `GST_DECLARATION_VERSION` (shared-types), the version of `verification.declare.text`; the API
// refuses any other with `400 DECLARATION_OUTDATED`.

const post = async <T = GstStateView>(url: string, body: object): Promise<T> => (await api.post<ApiSuccess<T>>(url, body)).data.data;

export async function fetchGstState(): Promise<GstStateView> {
  return (await api.get<ApiSuccess<GstStateView>>('/businesses/me/gst')).data.data;
}

/** Counts toward the business's 5 lookups a day (`429 GST_LOOKUP_LIMIT`). */
export const lookupGstin = (gstin: string) => post('/businesses/me/gst/lookup', { gstin });
/** "Yes, this is my business" + the declaration, on a fresh `found` lookup. */
export const declareGst = (checkId: string) => post('/businesses/me/gst/declare', { checkId });
/** The provider sends a code to the GSTIN's registered contact; 3 sends, 30 s apart. */
export const sendGstCode = (proofId: string) => post('/businesses/me/gst/otp/send', { proofId });
/** A correct code verifies GST (`400 GST_OTP_INVALID` with `details.attemptsLeft` otherwise). */
export const verifyGstCode = (proofId: string, code: string) => post('/businesses/me/gst/otp/verify', { proofId, code });

export interface ReviewFile {
  key: string;
  type: GstDocumentType;
}

export interface ReviewSubmission {
  gstin: string;
  /** "Can't get the code?": the lookup. Then `entered` is left out. */
  checkId?: string;
  entered?: {
    legalName: string;
    tradeName: string | null;
    address: { line: string; city: string; state: string; pincode: string };
    constitution: string;
  };
  uploadId: string;
  files: ReviewFile[];
}

/** Path A: closes any open instant attempt and puts the review in the officer's queue. */
export const submitReview = (body: ReviewSubmission) =>
  post('/businesses/me/gst/review', { ...body, declarationVersion: GST_DECLARATION_VERSION });

/** Files for a review in `needs_more`; sends it back to `waiting`. */
export const addReviewFiles = (proofId: string, files: ReviewFile[]) => post('/businesses/me/gst/review/files', { proofId, files });

/** A file picked on the phone (camera, gallery or PDF), before upload. */
export interface LocalDocument {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  /** From the picker; 0 when it didn't say (the upload measures the file itself). */
  size: number;
  type: GstDocumentType | null;
}

interface Presigned {
  url: string;
  key: string;
  expiresAt: string;
  uploadId: string;
}

/** An upload the storage refused (not an API error): `errorCode()` reads `UPLOAD_FAILED`. */
function uploadFailed(status: number): Error {
  return Object.assign(new Error(`upload ${status}`), { code: 'UPLOAD_FAILED' });
}

/**
 * Uploads each file to private storage (spec §6): `POST .../documents/presign` with its type and size → a signed PUT
 * of the bytes. A new submission's files share the upload id the first presign returns; files for a review in
 * `needs_more` use its proof id. `503 STORAGE_UNAVAILABLE` comes from the first presign when R2 isn't configured.
 */
export async function uploadDocuments(
  files: (LocalDocument & { type: GstDocumentType })[],
  target: { proofId?: string },
  onProgress?: (done: number, total: number) => void,
): Promise<{ uploadId: string; files: ReviewFile[] }> {
  let uploadId: string | undefined;
  const uploaded: ReviewFile[] = [];
  for (const [i, file] of files.entries()) {
    onProgress?.(i, files.length);
    const blob = await (await fetch(file.uri)).blob();
    const presigned = await post<Presigned>('/businesses/me/gst/documents/presign', {
      ...(target.proofId ? { proofId: target.proofId } : uploadId ? { uploadId } : {}),
      contentType: file.mimeType,
      size: blob.size,
    });
    uploadId = presigned.uploadId;
    // Content-Type and Content-Length are part of the signature: send exactly what was presigned.
    const res = await fetch(presigned.url, { method: 'PUT', headers: { 'Content-Type': file.mimeType }, body: blob });
    if (!res.ok) throw uploadFailed(res.status);
    uploaded.push({ key: presigned.key, type: file.type });
  }
  onProgress?.(files.length, files.length);
  return { uploadId: uploadId ?? target.proofId ?? '', files: uploaded };
}
