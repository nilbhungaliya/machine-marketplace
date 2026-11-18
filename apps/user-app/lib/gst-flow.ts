import {
  CONSTITUTIONS,
  GST_REVIEW_ADD_FILES_MAX,
  GST_REVIEW_ADD_FILES_MIN,
  GST_REVIEW_FILES_MAX,
  GST_REVIEW_FILES_MIN,
  GST_REVIEW_FILES_TOTAL_MAX,
  type BusinessProfile,
  type GstDocumentType,
  type GstState,
  type GstStateView,
} from '@mpm/shared-types';
import { isValidGstin, normalizeGstin } from './gstin';

// GST verification in the app (F1 spec §5, §7; plan Task 16): which screen a `GstStateView` opens, the Profile rows and
// completion meter, the lookup's input check and the review's file rule. Pure: no React, no network.

export type GstTarget =
  | { screen: 'GstStart' }
  | { screen: 'GstFound' }
  | { screen: 'GstCode' }
  | { screen: 'GstReviewForm'; params?: { checkId?: string; gstin?: string } }
  | { screen: 'GstStatus' };

/** Any screen Profile can open. */
export type AppTarget =
  | GstTarget
  | { screen: 'YourBusiness'; params: { mode: 'edit' } }
  | { screen: 'WhereAreYou'; params: { mode: 'edit' } };

const reviewForm = (gstin?: string, checkId?: string): GstTarget => {
  const params = { ...(checkId ? { checkId } : {}), ...(gstin ? { gstin } : {}) };
  return Object.keys(params).length > 0 ? { screen: 'GstReviewForm', params } : { screen: 'GstReviewForm' };
};

/**
 * The screen for a GST state. A decided or open review (and verified / revoked) shows the status screen; otherwise,
 * when the instant path is closed (`instantAllowed` false: mode `review`, or an officer revocation), the review form;
 * else `none` (also an expired lookup) → GSTIN entry, `found` → the found card, `code_sent` → the code screen.
 */
export function gstScreen(view: GstStateView): GstTarget {
  switch (view.state) {
    case 'under_review':
    case 'needs_more':
    case 'rejected':
    case 'verified':
    case 'revoked':
      return { screen: 'GstStatus' };
    default:
      break;
  }
  if (!view.instantAllowed) return reviewForm(view.state === 'none' ? undefined : view.gstin);
  if (view.state === 'found') return { screen: 'GstFound' };
  if (view.state === 'code_sent') return { screen: 'GstCode' };
  return { screen: 'GstStart' };
}

/** The latest lookup's outcome, shown on the GSTIN entry screen (spec §5.2 step 3, §5.5). */
export type StartNotice = 'expired' | 'held' | 'notFound' | 'statusRefused' | 'providerUnavailable';

export function startNotice(view: GstStateView): StartNotice | null {
  if (view.state !== 'none') return null;
  if (view.expired) return 'expired';
  if (view.held) return 'held';
  if (view.notFound) return 'notFound';
  if (view.statusRefused) return 'statusRefused';
  if (view.providerUnavailable) return 'providerUnavailable';
  return null;
}

/**
 * States in which GSTIN entry and the review form have nothing to do (an open review, or a verified GSTIN): those
 * screens open the status screen instead, before any lookup or upload. Rejected and revoked don't block: GSTIN entry
 * and the review form are how the user starts again.
 */
export function blocksNewAttempt(state: GstState): boolean {
  return state === 'under_review' || state === 'needs_more' || state === 'verified';
}

/** "Can't get the code?" (spec §5.2 step 7): the review form with the lookup attached. */
export function reviewFromCode(view: GstStateView): GstTarget {
  return reviewForm(view.gstin, view.checkId);
}

/** Start again after a rejection, or verify again after a revocation: the path §5.4's rule allows. */
export function startAgain(view: GstStateView): GstTarget {
  return view.instantAllowed ? { screen: 'GstStart' } : reviewForm(view.gstin);
}

/** The GSTIN as typed → the normalised GSTIN, or why it can't be looked up (the API's checks, run first here). */
export function prepareLookup(input: string): { ok: true; gstin: string } | { ok: false; error: 'empty' | 'invalid' } {
  const gstin = normalizeGstin(input);
  if (gstin === '') return { ok: false, error: 'empty' };
  return isValidGstin(gstin) ? { ok: true, gstin } : { ok: false, error: 'invalid' };
}

/** Whole seconds until `iso` (the resend timer), rounded up; 0 when it has passed or is missing. */
export function secondsUntil(iso: string | undefined, now: number): number {
  if (!iso) return 0;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

export type ChipTone = 'ok' | 'warn' | 'danger' | 'neutral';

/** The GST status chip on Profile. */
export function gstChip(state: GstState): { key: string; tone: ChipTone } {
  switch (state) {
    case 'verified':
      return { key: 'verification.chip.verified', tone: 'ok' };
    case 'under_review':
      return { key: 'verification.chip.underReview', tone: 'warn' };
    case 'needs_more':
      return { key: 'verification.chip.needsMore', tone: 'warn' };
    case 'rejected':
      return { key: 'verification.chip.rejected', tone: 'danger' };
    case 'revoked':
      return { key: 'verification.chip.revoked', tone: 'danger' };
    default:
      return { key: 'verification.chip.notVerified', tone: 'neutral' };
  }
}

export type ProfileRow = 'business' | 'location' | 'gst';

/** Profile rows open the onboarding screens in edit mode; GST opens the screen `gstScreen` picks. */
export function profileRowTarget(row: ProfileRow, gst?: GstStateView | null): AppTarget {
  if (row === 'business') return { screen: 'YourBusiness', params: { mode: 'edit' } };
  if (row === 'location') return { screen: 'WhereAreYou', params: { mode: 'edit' } };
  return gst ? gstScreen(gst) : { screen: 'GstStart' };
}

export type CompletionKey = keyof BusinessProfile['completion'];

/** The completion meter's four segments (spec §4.1), in order, each with the row whose screen completes it. */
export function completionSegments(c: BusinessProfile['completion']): { key: CompletionKey; done: boolean; row: ProfileRow }[] {
  return [
    { key: 'name', done: c.name, row: 'business' },
    { key: 'activities', done: c.activities, row: 'business' },
    { key: 'location', done: c.location, row: 'location' },
    { key: 'gst', done: c.gst, row: 'gst' },
  ];
}

// ─── Review documents (spec §5.3, §6) ───

export const DOCUMENT_MAX_BYTES = 10_485_760;
/** A submission's files (shared-types, the API's numbers). */
export const DOCUMENTS_MIN = GST_REVIEW_FILES_MIN;
export const DOCUMENTS_MAX = GST_REVIEW_FILES_MAX;
export const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

export interface PickedDocumentInfo {
  /** Chosen by the user per file; `null` until they do. */
  type: GstDocumentType | null;
  size: number;
  mimeType: string;
}

/** `total`: adding these would take the review past GST_REVIEW_FILES_TOTAL_MAX files. */
export type DocumentProblem = 'untyped' | 'fileType' | 'tooLarge' | 'count' | 'total' | 'certificate' | 'person';

/**
 * Why these files can't be sent yet, or `null`. `existing`: the types already on the review (adding files after the
 * officer asks for more), counted toward the 2–5 files, the certificate and the ID / letter.
 */
export function documentProblem(files: PickedDocumentInfo[], existing: GstDocumentType[] = []): DocumentProblem | null {
  if (files.some((f) => f.type === null)) return 'untyped';
  if (files.some((f) => !(DOCUMENT_MIME_TYPES as readonly string[]).includes(f.mimeType))) return 'fileType';
  if (files.some((f) => f.size > DOCUMENT_MAX_BYTES)) return 'tooLarge';
  const types = [...existing, ...files.map((f) => f.type as GstDocumentType)];
  if (files.length === 0 || types.length < DOCUMENTS_MIN || types.length > DOCUMENTS_MAX) return 'count';
  if (!types.includes('gst_certificate')) return 'certificate';
  if (!types.includes('id_proof') && !types.includes('authorisation_letter')) return 'person';
  return null;
}

/** How many files can still be added to a review holding `existing` (the state view's `documentCount`). */
export function addFilesRoom(existing: number | undefined): number {
  return Math.max(0, Math.min(GST_REVIEW_ADD_FILES_MAX, GST_REVIEW_FILES_TOTAL_MAX - (existing ?? 0)));
}

/**
 * Files added to a review the officer sent back (spec §5.3 amendment, the API's rule): 1–5 new files (`count`), at
 * most GST_REVIEW_FILES_TOTAL_MAX on the review in all (`total`; `existing` is the state view's `documentCount`). The
 * certificate / ID rule over the whole set is checked by the API (`DOCUMENTS_REQUIRED`): the view gives the count, not
 * the types.
 */
export function newFilesProblem(files: PickedDocumentInfo[], existing = 0): DocumentProblem | null {
  if (files.some((f) => f.type === null)) return 'untyped';
  if (files.some((f) => !(DOCUMENT_MIME_TYPES as readonly string[]).includes(f.mimeType))) return 'fileType';
  if (files.some((f) => f.size > DOCUMENT_MAX_BYTES)) return 'tooLarge';
  if (files.length < GST_REVIEW_ADD_FILES_MIN || files.length > GST_REVIEW_ADD_FILES_MAX) return 'count';
  if (existing + files.length > GST_REVIEW_FILES_TOTAL_MAX) return 'total';
  return null;
}

/**
 * The translation key for a constitution. Officer-approved details carry a shared-types key (`private_limited`…),
 * a provider's lookup sends its own text: a key → `verification.constitution.<key>`, anything else → null (show the
 * text as it came).
 */
export function constitutionKey(value: string): string | null {
  return (CONSTITUTIONS as readonly string[]).includes(value) ? `verification.constitution.${value}` : null;
}

/** API error codes of the GST routes → translated copy (`verification.errors.*`). */
export const GST_ERROR_KEYS: Record<string, string> = {
  GSTIN_INVALID: 'verification.errors.gstinInvalid',
  GSTIN_TAKEN: 'verification.errors.gstinTaken',
  GST_LOOKUP_LIMIT: 'verification.errors.lookupLimit',
  GST_REVIEW_ONLY: 'verification.errors.reviewOnly',
  GST_ALREADY_VERIFIED: 'verification.errors.alreadyVerified',
  GST_REVIEW_OPEN: 'verification.errors.reviewOpen',
  GST_LOOKUP_EXPIRED: 'verification.errors.lookupExpired',
  GST_PROOF_CLOSED: 'verification.errors.proofClosed',
  GST_CHECK_NOT_USABLE: 'verification.errors.proofClosed',
  GST_OTP_LIMIT: 'verification.errors.otpLimit',
  GST_OTP_TOO_SOON: 'verification.errors.otpTooSoon',
  GST_OTP_INVALID: 'verification.errors.otpInvalid',
  GST_UNAVAILABLE: 'verification.errors.unavailable',
  GST_REVIEW_STATE: 'verification.errors.reviewState',
  STORAGE_UNAVAILABLE: 'verification.errors.storageUnavailable',
  DOCUMENTS_REQUIRED: 'verification.documents.rule',
  DOCUMENT_TYPE: 'verification.documents.fileType',
  MEDIA_TOO_LARGE: 'verification.documents.tooLarge',
  DOCUMENT_KEY_INVALID: 'verification.errors.uploadFailed',
  DOCUMENT_MISSING: 'verification.errors.uploadFailed',
  GST_OTHER_GSTIN_HELD: 'verification.errors.otherGstinHeld',
  UPLOAD_FAILED: 'verification.errors.uploadFailed',
  DECLARATION_OUTDATED: 'verification.errors.declarationOutdated',
  RATE_LIMITED: 'verification.errors.rateLimited',
  NO_BUSINESS: 'onboarding.errors.noBusiness',
};
