import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import {
  GST_REVIEW_ADD_FILES_MAX,
  GST_REVIEW_ADD_FILES_MIN,
  GST_REVIEW_FILES_MAX,
  GST_REVIEW_FILES_MIN,
  GST_REVIEW_FILES_TOTAL_MAX,
  type AdminDocumentUrl,
  type AdminGstReviewDetail,
  type AdminGstReviewRow,
  type GstApprovalEdits,
  type GstDetails,
  type GstDocumentType,
  type GstEnteredDetails,
  type GstReviewQueue,
  type GstStateView,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, gstChecks, gstRepresentativeProofs, users } from '../../db/schema.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { PRIVATE_GET_TTL_SECONDS, isStorageConfigured, requireStorage } from '../../lib/storage.js';
import { adminText } from '../../lib/admin-text.js';
import { writeAudit } from '../audit.service.js';
import { deleteKeys, documentFormat, presignDocumentRead, stageDocuments } from './gst-documents.service.js';
import { grantGst, gstinTaken, holderOf, lockBusinessRow, lockGstin } from './gst-grant.service.js';
import { gstHistory } from './gst-history.service.js';
import { DECLARATION_VERSION, type GstActor } from './gst-instant.service.js';
import { getGstMode } from './gst-mode.js';
import { getGstProvider, type GstLookup } from './gst-provider.js';
import { OPEN_REVIEW_STATUSES, activeGstVerification, getGstState, openReview } from './gst-state.service.js';
import { parseGstin } from './gstin.js';

/**
 * GST path A, the officer review (F1 + A2 spec §5.3, §5.4a, §6; textile `gst-proof.service.ts`
 * `submitRepresentativeDocuments`, `gst-claims.service.ts` `decideRepresentativeProof` / `listRepresentativeProofs` /
 * `getRepresentativeProofDetail`).
 *
 * A review is a `gst_representative_proofs` row with `method = documents`: `waiting` ⇄ `needs_more` → `approved` /
 * `rejected`. The stored summary (`businesses.verification_status` / `verification_note`) is written in the same
 * transaction as each step (§5.4a).
 *
 * Lock order, everywhere: the business row first (`lockBusinessRow`, the lock `verifyGstCode` and `grantGst` take),
 * then the proof row, then (approval only) the GSTIN's advisory lock. Every officer decision takes the business row
 * lock first and holds it until commit, so two decisions on one review run one after the other; the second then
 * claims the review (`claimReview`: `UPDATE … WHERE status IN (…) RETURNING`) against the first one's committed
 * status and gets `409 STALE_REVIEW`, writing nothing. Reject and ask-for-more write their new status in the claim
 * itself. Approve's claim only checks `waiting` and locks the proof row: its status becomes `approved` later, in
 * `grantGst`, because a refused approval (`GST_NOT_ACTIVE`) commits its lookup row and must leave the review
 * `waiting`. For approve, the business lock is what makes a second decision see `approved`.
 */

/** The Decided tab's window (§8.1). */
export const DECIDED_WINDOW_DAYS = 90;
const LIST_LIMIT = 200;

export type DocumentFile = { key: string; type: GstDocumentType };
/** `stageDocuments`, replaceable in tests (no R2 there). */
export type StageFn = typeof stageDocuments;
/** Deletes storage objects and never throws (`deleteKeys`); replaceable in tests. */
export type RemoveFn = (keys: string[]) => Promise<void>;

export interface StagingOptions {
  stage?: StageFn;
  remove?: RemoveFn;
  /** Where a failed cleanup delete is logged (the request's logger). */
  log?: { error: (obj: unknown, msg?: string) => void };
}

function staging(opts: StagingOptions): { stage: StageFn; remove: RemoveFn } {
  return { stage: opts.stage ?? stageDocuments, remove: opts.remove ?? ((keys) => deleteKeys(keys, opts.log)) };
}

// ─── Errors ───

function reviewOpen(): ConflictError {
  return new ConflictError('Your GST documents are under review', 'GST_REVIEW_OPEN');
}

function alreadyVerified(): ConflictError {
  return new ConflictError('Your GST is already verified', 'GST_ALREADY_VERIFIED');
}

function staleReview(): ConflictError {
  return new ConflictError('Someone already decided this review', 'STALE_REVIEW');
}

function reviewState(): ConflictError {
  return new ConflictError("This review isn't waiting for more files", 'GST_REVIEW_STATE');
}

function checkNotUsable(): ConflictError {
  return new ConflictError("This lookup can't be used for a review", 'GST_CHECK_NOT_USABLE');
}

/** At least one GST registration certificate and at least one ID of a named person or authorisation letter. */
function coversBoth(files: Array<{ type: GstDocumentType }>): boolean {
  const certificate = files.some((f) => f.type === 'gst_certificate');
  const person = files.some((f) => f.type === 'id_proof' || f.type === 'authorisation_letter');
  return certificate && person;
}

/** A submission (§5.3): 2–5 files covering the certificate and the ID / letter. Otherwise `400 DOCUMENTS_REQUIRED`. */
function checkDocuments(files: Array<{ type: GstDocumentType }>): void {
  if (files.length < GST_REVIEW_FILES_MIN || files.length > GST_REVIEW_FILES_MAX || !coversBoth(files)) {
    throw new ValidationError(
      'Add 2 to 5 files: the GST registration certificate, and an ID of a person named on it or an authorisation letter',
      { min: GST_REVIEW_FILES_MIN, max: GST_REVIEW_FILES_MAX },
      'DOCUMENTS_REQUIRED',
    );
  }
}

/**
 * Files added after ask-for-more (§5.3, amended 2026-11-18): 1–5 **new** files; the review's files and the new ones
 * together cover the certificate and the ID / letter and number at most 10. Otherwise `400 DOCUMENTS_REQUIRED`.
 */
function checkAddedDocuments(existing: Array<{ type: GstDocumentType }>, added: Array<{ type: GstDocumentType }>): void {
  const all = [...existing, ...added];
  if (
    added.length < GST_REVIEW_ADD_FILES_MIN ||
    added.length > GST_REVIEW_ADD_FILES_MAX ||
    all.length > GST_REVIEW_FILES_TOTAL_MAX ||
    !coversBoth(all)
  ) {
    throw new ValidationError(
      `Add 1 to 5 files, up to ${GST_REVIEW_FILES_TOTAL_MAX} on the review in all. Together they need the GST registration certificate and an ID of a person named on it or an authorisation letter`,
      { min: GST_REVIEW_ADD_FILES_MIN, max: GST_REVIEW_ADD_FILES_MAX, totalMax: GST_REVIEW_FILES_TOTAL_MAX, existing: existing.length },
      'DOCUMENTS_REQUIRED',
    );
  }
}

const blankToNull = (s: string | null | undefined): string | null => (s && s.trim() !== '' ? s.trim() : null);

// ─── The business submits (§5.3) ───

export interface SubmitReviewInput {
  gstin: string;
  /** "Can't get the code?": the business's `found` lookup. Then `entered` is not sent. */
  checkId?: string;
  /** No lookup attached: what the business types. */
  entered?: { legalName: string; tradeName?: string | null; address: GstDetails['address']; constitution: string };
  declarationVersion: number;
  /** The upload id the document presign returned. */
  uploadId: string;
  files: DocumentFile[];
}

/**
 * The submit refusals that need the database (§5.3), run once before staging (so nothing is copied for a refused
 * submission) and again inside the transaction with the business row locked: an active `gst` verification → `409
 * GST_ALREADY_VERIFIED`; an open review → `409 GST_REVIEW_OPEN`; another business holds the GSTIN → `409 GSTIN_TAKEN`
 * (the "already linked" message, nothing filed); an attached lookup must be this business's own (`404`), a `found`
 * one, for this GSTIN (`409 GST_CHECK_NOT_USABLE`, ruling R8: a `held` lookup carries another business's details).
 */
async function assertMaySubmit(conn: Db | Tx, businessId: string, gstin: string, checkId: string | undefined): Promise<void> {
  if ((await activeGstVerification(conn, businessId)) !== null) throw alreadyVerified();
  if ((await openReview(conn, businessId)) !== null) throw reviewOpen();
  if ((await holderOf(conn, gstin, businessId)) !== null) throw gstinTaken();
  if (checkId) {
    const [check] = await conn
      .select({ gstin: gstChecks.gstin, result: gstChecks.result })
      .from(gstChecks)
      .where(and(eq(gstChecks.id, checkId), eq(gstChecks.businessId, businessId), eq(gstChecks.source, 'business')));
    if (!check) throw new NotFoundError('GST lookup');
    if (check.result !== 'found' || check.gstin !== gstin) throw checkNotUsable();
  }
}

/**
 * POST /businesses/me/gst/review (§5.3, §6). Checks, in order: the GSTIN (`400 GSTIN_INVALID`), the declaration
 * version, `entered` iff no `checkId` (`400`), the file rule (`400 DOCUMENTS_REQUIRED`), then the database refusals
 * (`assertMaySubmit`). Then Task 9's order: `stage` copies the files to `verification/<businessId>/<proofId>/` before
 * any transaction (`503 STORAGE_UNAVAILABLE` without storage); one transaction locks the business row, re-checks,
 * **spends every `declared` / `code_sent` proof of the business** (a late code can't verify while the review waits),
 * creates the `waiting` proof with the copied keys and sets the summary `pending` (note cleared); after the commit the
 * incoming files are deleted, and on any failure the copies are.
 */
export async function submitReview(db: Db, actor: GstActor, body: SubmitReviewInput, opts: StagingOptions = {}): Promise<GstStateView> {
  const gstin = parseGstin(body.gstin);
  if (body.declarationVersion !== DECLARATION_VERSION) {
    throw new ValidationError('Accept the current declaration', { declarationVersion: DECLARATION_VERSION }, 'DECLARATION_OUTDATED');
  }
  if (body.checkId && body.entered) throw new ValidationError('Send the lookup or the details, not both');
  if (!body.checkId && !body.entered) throw new ValidationError('Enter the legal name, principal address and constitution');
  checkDocuments(body.files);
  const entered: GstEnteredDetails | null = body.entered
    ? {
        legalName: body.entered.legalName.trim(),
        tradeName: blankToNull(body.entered.tradeName),
        address: body.entered.address,
        constitution: body.entered.constitution.trim(),
      }
    : null;

  await assertMaySubmit(db, actor.businessId, gstin, body.checkId);

  const { stage, remove } = staging(opts);
  const proofId = randomUUID();
  const staged = await stage({ businessId: actor.businessId, uploadId: body.uploadId, proofId, files: body.files });
  let view: GstStateView;
  try {
    view = await db.transaction(async (tx) => {
      await lockBusinessRow(tx, actor.businessId);
      await assertMaySubmit(tx, actor.businessId, gstin, body.checkId);
      await tx
        .update(gstRepresentativeProofs)
        .set({ status: 'spent', updatedAt: sql`now()` })
        .where(
          and(eq(gstRepresentativeProofs.businessId, actor.businessId), inArray(gstRepresentativeProofs.status, ['declared', 'code_sent'])),
        );
      await tx.insert(gstRepresentativeProofs).values({
        id: proofId,
        checkId: body.checkId ?? null,
        businessId: actor.businessId,
        userId: actor.userId,
        gstin,
        declarationVersion: body.declarationVersion,
        method: 'documents',
        status: 'waiting',
        entered,
        documents: staged.copied,
      });
      await tx
        .update(businesses)
        .set({ verificationStatus: 'pending', verificationNote: null, updatedAt: sql`now()` })
        .where(eq(businesses.id, actor.businessId));
      return getGstState(tx, actor.businessId);
    });
  } catch (err) {
    await remove(staged.copied.map((c) => c.key));
    if (isUniqueViolation(err, 'gst_proofs_one_open_review_uq')) throw reviewOpen();
    throw err;
  }
  await remove(staged.incoming);
  return view;
}

/**
 * POST /businesses/me/gst/review/files (§5.3 "the business … adds files (same limits), which sends it back to
 * `waiting`"). Only on this business's review in `needs_more` (`404` / `409 GST_REVIEW_STATE`); 1–5 new files, the
 * whole set ≤ 10 and covering the certificate and the ID / letter (`checkAddedDocuments`, `400 DOCUMENTS_REQUIRED`;
 * the 2–5 rule is a submission's only, so a review sent back with 5 files can still be answered). The files are uploaded
 * with the proof's id as the upload id. Same order as `submitReview`: stage, then (business row, then proof row
 * locked) append the copied keys, set `waiting` and the summary `pending` (note cleared); delete the incoming files
 * after the commit, the copies on failure.
 */
export async function addReviewFiles(
  db: Db,
  actor: GstActor,
  proofId: string,
  input: { files: DocumentFile[] },
  opts: StagingOptions = {},
): Promise<GstStateView> {
  const own = and(eq(gstRepresentativeProofs.id, proofId), eq(gstRepresentativeProofs.businessId, actor.businessId), eq(gstRepresentativeProofs.method, 'documents'));
  const [current] = await db.select().from(gstRepresentativeProofs).where(own);
  if (!current) throw new NotFoundError('GST review');
  if (current.status !== 'needs_more') throw reviewState();
  checkAddedDocuments(current.documents, input.files);

  const { stage, remove } = staging(opts);
  const staged = await stage({ businessId: actor.businessId, uploadId: proofId, proofId, files: input.files });
  let view: GstStateView;
  try {
    view = await db.transaction(async (tx) => {
      await lockBusinessRow(tx, actor.businessId);
      const [proof] = await tx.select().from(gstRepresentativeProofs).where(own).for('update');
      if (!proof) throw new NotFoundError('GST review');
      if (proof.status !== 'needs_more') throw reviewState();
      checkAddedDocuments(proof.documents, staged.copied);
      const documents = [...proof.documents, ...staged.copied];
      await tx
        .update(gstRepresentativeProofs)
        .set({ documents, status: 'waiting', updatedAt: sql`now()` })
        .where(eq(gstRepresentativeProofs.id, proof.id));
      await tx
        .update(businesses)
        .set({ verificationStatus: 'pending', verificationNote: null, updatedAt: sql`now()` })
        .where(eq(businesses.id, actor.businessId));
      return getGstState(tx, actor.businessId);
    });
  } catch (err) {
    await remove(staged.copied.map((c) => c.key));
    throw err;
  }
  await remove(staged.incoming);
  return view;
}

// ─── Officer decisions (§5.3, §8.1) ───

export interface ReviewDecision {
  id: string;
  businessId: string;
  status: 'approved' | 'rejected' | 'needs_more';
}

/** The review's business row, locked (first, as everywhere). `404` for an unknown id or a proof that isn't a review. */
async function lockReviewBusiness(tx: Tx, id: string) {
  const [row] = await tx
    .select({ businessId: gstRepresentativeProofs.businessId })
    .from(gstRepresentativeProofs)
    .where(and(eq(gstRepresentativeProofs.id, id), eq(gstRepresentativeProofs.method, 'documents')));
  if (!row) throw new NotFoundError('GST review');
  return lockBusinessRow(tx, row.businessId);
}

type OpenReviewStatus = (typeof OPEN_REVIEW_STATUSES)[number];

/**
 * The STALE_REVIEW guard: claims the review only while its status is one of `from`, writing `set`; otherwise `409
 * STALE_REVIEW` (nothing written). Callers hold the business row lock (see the header). Returns the updated row and
 * `claimedFrom`, the status it had before.
 */
async function claimReview(
  tx: Tx,
  id: string,
  from: readonly OpenReviewStatus[],
  set: PgUpdateSetSource<typeof gstRepresentativeProofs>,
) {
  const [before] = await tx
    .select({ status: gstRepresentativeProofs.status })
    .from(gstRepresentativeProofs)
    .where(eq(gstRepresentativeProofs.id, id))
    .for('update');
  const [row] = await tx
    .update(gstRepresentativeProofs)
    .set({ ...set, updatedAt: sql`now()` })
    .where(and(eq(gstRepresentativeProofs.id, id), inArray(gstRepresentativeProofs.status, [...from])))
    .returning();
  if (!row || !before) throw staleReview();
  return { ...row, claimedFrom: before.status as OpenReviewStatus };
}

type ProofRow = typeof gstRepresentativeProofs.$inferSelect;

/**
 * The details an officer approves when no fresh lookup decides (mode `review`, or the provider down): what the
 * business typed, else the attached lookup's, with the officer's `edits` laid over them. A trade name edited to null
 * or blank clears it.
 */
async function officerDetails(tx: Tx, proof: ProofRow, edits: GstApprovalEdits): Promise<GstDetails> {
  let base: GstDetails;
  if (proof.entered) {
    base = { ...proof.entered, natureOfBusiness: null, registeredOn: null, status: 'active' };
  } else {
    const [check] = proof.checkId
      ? await tx.select({ result: gstChecks.result, details: gstChecks.details }).from(gstChecks).where(eq(gstChecks.id, proof.checkId))
      : [];
    if (!check || check.result !== 'found' || !check.details) throw checkNotUsable();
    base = check.details;
  }
  return {
    ...base,
    ...(edits.legalName !== undefined ? { legalName: edits.legalName.trim() } : {}),
    ...(edits.tradeName !== undefined ? { tradeName: blankToNull(edits.tradeName) } : {}),
    ...(edits.address !== undefined ? { address: edits.address } : {}),
    ...(edits.constitution !== undefined ? { constitution: edits.constitution.trim() } : {}),
    status: 'active',
  };
}

/** The officer's lookup at approval: a `gst_checks` row with `source = officer`, which never counts toward the business's day. */
async function recordOfficerCheck(tx: Tx, adminId: string, proof: ProofRow, lookup: GstLookup): Promise<void> {
  const base = { businessId: proof.businessId, gstin: proof.gstin, source: 'officer' as const, adminId };
  if (lookup.kind === 'unavailable') {
    await tx.insert(gstChecks).values({ ...base, result: 'failed', resolvedAt: null });
  } else if (lookup.kind === 'not_found') {
    await tx.insert(gstChecks).values({ ...base, result: 'not_found', resolvedAt: sql`now()` });
  } else {
    await tx.insert(gstChecks).values({
      ...base,
      result: lookup.details.status === 'active' ? 'found' : 'status_refused',
      providerRef: lookup.ref,
      gstStatus: lookup.details.status,
      details: lookup.details,
      resolvedAt: sql`now()`,
    });
  }
}

/**
 * The outcome of an approval. `refused` is a refusal that keeps its writes (the officer's lookup row): the caller
 * commits the transaction and then throws `error` (`409 GST_NOT_ACTIVE`).
 */
export type ApproveOutcome = { kind: 'approved'; review: ReviewDecision } | { kind: 'refused'; error: AppError };

/**
 * POST /admin/verification/reviews/:id/approve (§5.3's table). Locks the business row, claims the review while it is
 * `waiting` (`409 STALE_REVIEW`), refuses an active `gst` verification (`409 GST_ALREADY_VERIFIED`), takes the GSTIN
 * lock and refuses a GSTIN another business holds (`409 GSTIN_TAKEN`). No 30-minute rule and no revocation rule: the
 * officer is the decision. Then:
 * - provider available (mode `live` / `stub`): a fresh lookup, recorded as the officer's; `active` → granted with the
 *   lookup's details (edits ignored, `lookup_at_approval = active`); not found or not active → **refused**
 *   (`GST_NOT_ACTIVE`, the lookup row kept, the review stays `waiting`); unreachable → the officer's details
 *   (`lookup_at_approval = unavailable`);
 * - mode `review`: the officer's details (`lookup_at_approval = none`).
 * `grantGst` (`officer_review`, `replaceHeld`: a different GSTIN the business still holds after a revocation is
 * replaced and so released) writes the GST fields, the verification and the summary `approved`; the details are kept
 * as `approved_details`; one audit row.
 */
export async function approveReview(tx: Tx, adminId: string, id: string, edits: GstApprovalEdits = {}): Promise<ApproveOutcome> {
  const business = await lockReviewBusiness(tx, id);
  // Checks `waiting` and locks the proof row; `grantGst` writes `approved` (see the header).
  const proof = await claimReview(tx, id, ['waiting'], {});
  if ((await activeGstVerification(tx, business.id)) !== null) throw alreadyVerified();
  await lockGstin(tx, proof.gstin);
  if ((await holderOf(tx, proof.gstin, business.id)) !== null) throw gstinTaken();

  let details: GstDetails;
  let lookupAtApproval: 'active' | 'unavailable' | 'none';
  if (getGstMode() === 'review') {
    details = await officerDetails(tx, proof, edits);
    lookupAtApproval = 'none';
  } else {
    const lookup = await getGstProvider().lookup(proof.gstin);
    await recordOfficerCheck(tx, adminId, proof, lookup);
    if (lookup.kind === 'unavailable') {
      details = await officerDetails(tx, proof, edits);
      lookupAtApproval = 'unavailable';
    } else if (lookup.kind === 'not_found' || lookup.details.status !== 'active') {
      const status = lookup.kind === 'not_found' ? 'not found' : lookup.details.status;
      return {
        kind: 'refused',
        error: new ConflictError(`The GST portal shows this GSTIN as ${status}. Only an active GSTIN can be verified.`, 'GST_NOT_ACTIVE'),
      };
    } else {
      details = lookup.details;
      lookupAtApproval = 'active';
    }
  }

  await grantGst(tx, {
    businessId: business.id,
    gstin: proof.gstin,
    details,
    method: 'officer_review',
    proofId: proof.id,
    adminId,
    replaceHeld: true,
  });
  await tx
    .update(gstRepresentativeProofs)
    .set({ approvedDetails: details, lookupAtApproval })
    .where(eq(gstRepresentativeProofs.id, proof.id));

  const replaced = business.gstin !== null && business.gstin !== proof.gstin ? business.gstin : null;
  await writeAudit(tx, {
    adminId,
    action: 'gst_review.approve',
    entityType: 'gst_review',
    entityId: proof.id,
    before: { status: 'waiting', businessId: business.id, gstin: business.gstin, verificationStatus: business.verificationStatus },
    after: {
      status: 'approved',
      gstin: proof.gstin,
      approvedDetails: details,
      lookupAtApproval,
      edits,
      ...(replaced ? { replacedGstin: replaced } : {}),
    },
  });
  return { kind: 'approved', review: { id: proof.id, businessId: business.id, status: 'approved' } };
}

/**
 * POST …/reject: `waiting` or `needs_more` → `rejected` with the reason (3–500); the summary `rejected`, note = the
 * reason (§5.4a). Rejecting a review sent back for more files closes one the business never answers (§5.3 amendment).
 */
export async function rejectReview(tx: Tx, adminId: string, id: string, reason: string): Promise<ReviewDecision> {
  const why = adminText(reason, 'reason');
  const business = await lockReviewBusiness(tx, id);
  const proof = await claimReview(tx, id, ['waiting', 'needs_more'], {
    status: 'rejected',
    reason: why,
    officerId: adminId,
    decidedAt: sql`now()`,
  });
  await tx
    .update(businesses)
    .set({ verificationStatus: 'rejected', verificationNote: why, updatedAt: sql`now()` })
    .where(eq(businesses.id, business.id));
  await writeAudit(tx, {
    adminId,
    action: 'gst_review.reject',
    entityType: 'gst_review',
    entityId: proof.id,
    before: { status: proof.claimedFrom, businessId: business.id, verificationStatus: business.verificationStatus },
    after: { status: 'rejected', reason: why, verificationStatus: 'rejected' },
  });
  return { id: proof.id, businessId: business.id, status: 'rejected' };
}

/** POST …/ask-for-more: `waiting` → `needs_more` with the message (3–500); the summary `pending`, note = the message. */
export async function askForMore(tx: Tx, adminId: string, id: string, message: string): Promise<ReviewDecision> {
  const text = adminText(message, 'message');
  const business = await lockReviewBusiness(tx, id);
  const proof = await claimReview(tx, id, ['waiting'], { status: 'needs_more', officerMessage: text });
  await tx
    .update(businesses)
    .set({ verificationStatus: 'pending', verificationNote: text, updatedAt: sql`now()` })
    .where(eq(businesses.id, business.id));
  await writeAudit(tx, {
    adminId,
    action: 'gst_review.ask_for_more',
    entityType: 'gst_review',
    entityId: proof.id,
    before: { status: 'waiting', businessId: business.id, verificationStatus: business.verificationStatus },
    after: { status: 'needs_more', message: text, verificationStatus: 'pending' },
  });
  return { id: proof.id, businessId: business.id, status: 'needs_more' };
}

/**
 * GET /admin/verification/documents/:proofId/:index/url (§6 "Reading"): `503 STORAGE_UNAVAILABLE` first; the review's
 * document at `index` (`404` otherwise); a 300 s presigned GET served inline with the file's type; one
 * `gst_document.view` audit row per URL issued.
 */
export async function documentUrl(tx: Tx, adminId: string, proofId: string, index: number): Promise<AdminDocumentUrl> {
  requireStorage();
  const [proof] = await tx
    .select({ businessId: gstRepresentativeProofs.businessId, documents: gstRepresentativeProofs.documents })
    .from(gstRepresentativeProofs)
    .where(and(eq(gstRepresentativeProofs.id, proofId), eq(gstRepresentativeProofs.method, 'documents')));
  if (!proof) throw new NotFoundError('GST review');
  const doc = Number.isInteger(index) && index >= 0 ? proof.documents[index] : undefined;
  const format = doc ? documentFormat(doc.key) : null;
  if (!doc || !format) throw new NotFoundError('Document');
  const url = await presignDocumentRead(doc.key);
  const expiresAt = new Date(Date.now() + PRIVATE_GET_TTL_SECONDS * 1000).toISOString();
  await writeAudit(tx, {
    adminId,
    action: 'gst_document.view',
    entityType: 'gst_review',
    entityId: proofId,
    before: null,
    after: { businessId: proof.businessId, index, type: doc.type, key: doc.key },
  });
  return { url, type: doc.type, format, expiresAt };
}

// ─── Queue and detail (§8.1) ───

/** Waiting and Needs more oldest first; Decided (approved / rejected in the last 90 days) newest first. */
export async function listReviews(conn: Db | Tx, queue: GstReviewQueue): Promise<AdminGstReviewRow[]> {
  const p = gstRepresentativeProofs;
  const where: SQL | undefined =
    queue === 'decided'
      ? and(
          eq(p.method, 'documents'),
          inArray(p.status, ['approved', 'rejected']),
          sql`${p.decidedAt} > now() - make_interval(days => ${DECIDED_WINDOW_DAYS}::int)`,
        )
      : and(eq(p.method, 'documents'), eq(p.status, queue));
  const rows = await conn
    .select({
      id: p.id,
      businessId: p.businessId,
      businessName: businesses.tradeName,
      city: businesses.city,
      gstin: p.gstin,
      status: p.status,
      checkId: p.checkId,
      documentCount: sql<number>`jsonb_array_length(${p.documents})`,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      decidedAt: p.decidedAt,
    })
    .from(p)
    .innerJoin(businesses, eq(businesses.id, p.businessId))
    .where(where)
    .orderBy(...(queue === 'decided' ? [desc(p.decidedAt), desc(p.id)] : [asc(p.createdAt), asc(p.id)]))
    .limit(LIST_LIMIT);
  return rows.map(({ checkId, ...r }) => ({
    ...r,
    hasLookup: checkId !== null,
    documentCount: Number(r.documentCount),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  }));
}

/** How many reviews are in `status` (the admin nav badge counts `waiting`), without the list's 200-row cap. */
export async function countReviews(conn: Db | Tx, status: OpenReviewStatus): Promise<number> {
  const [row] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(gstRepresentativeProofs)
    .where(and(eq(gstRepresentativeProofs.method, 'documents'), eq(gstRepresentativeProofs.status, status)));
  return Number(row?.count ?? 0);
}

/** Case, spaces and punctuation don't make a mismatch. */
const comparable = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * GET /admin/verification/reviews/:id: what the business typed or the attached lookup (only ever a `found` lookup of
 * this business, R8), the documents by index and type (no keys), the mismatch flags against the business's profile,
 * the business's GST history, and whether a provider is available at approval (`getGstMode() !== 'review'`).
 */
export async function getReviewDetail(conn: Db | Tx, id: string): Promise<AdminGstReviewDetail> {
  const [row] = await conn
    .select({ proof: gstRepresentativeProofs, business: businesses, user: { id: users.id, name: users.name, phone: users.phone } })
    .from(gstRepresentativeProofs)
    .innerJoin(businesses, eq(businesses.id, gstRepresentativeProofs.businessId))
    .innerJoin(users, eq(users.id, gstRepresentativeProofs.userId))
    .where(and(eq(gstRepresentativeProofs.id, id), eq(gstRepresentativeProofs.method, 'documents')));
  if (!row) throw new NotFoundError('GST review');
  const { proof, business: b } = row;

  let lookup: AdminGstReviewDetail['lookup'] = null;
  if (proof.checkId) {
    const [check] = await conn
      .select({ id: gstChecks.id, businessId: gstChecks.businessId, result: gstChecks.result, details: gstChecks.details, resolvedAt: gstChecks.resolvedAt })
      .from(gstChecks)
      .where(eq(gstChecks.id, proof.checkId));
    if (check && check.businessId === b.id && check.result === 'found' && check.details) {
      lookup = { checkId: check.id, details: check.details, resolvedAt: check.resolvedAt?.toISOString() ?? null };
    }
  }

  const gst = lookup?.details ?? proof.entered;
  const gstNames = gst ? [gst.legalName, gst.tradeName].filter((n): n is string => !!n).map(comparable) : [];
  const mismatches = {
    legalName: gst !== null && !gstNames.includes(comparable(b.tradeName)),
    pincode: gst !== null && !!b.pincode && b.pincode !== gst.address.pincode,
  };

  return {
    id: proof.id,
    status: proof.status,
    gstin: proof.gstin,
    declarationVersion: proof.declarationVersion,
    declaredAt: proof.declaredAt.toISOString(),
    createdAt: proof.createdAt.toISOString(),
    updatedAt: proof.updatedAt.toISOString(),
    decidedAt: proof.decidedAt?.toISOString() ?? null,
    officerMessage: proof.officerMessage,
    reason: proof.reason,
    lookupAtApproval: proof.lookupAtApproval,
    approvedDetails: proof.approvedDetails,
    business: {
      id: b.id,
      tradeName: b.tradeName,
      gstin: b.gstin,
      addressLine: b.addressLine,
      city: b.city,
      state: b.state,
      pincode: b.pincode,
      verificationStatus: b.verificationStatus,
    },
    submittedBy: row.user,
    entered: proof.entered,
    lookup,
    mismatches,
    documents: proof.documents.flatMap((d, index) => {
      const format = documentFormat(d.key);
      return format ? [{ index, type: d.type, format }] : [];
    }),
    history: await gstHistory(conn, b.id),
    providerAvailable: getGstMode() !== 'review',
    storageAvailable: isStorageConfigured(),
  };
}
