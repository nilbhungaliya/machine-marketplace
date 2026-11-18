import { and, eq, ne, sql } from 'drizzle-orm';
import type { PgInsertValue } from 'drizzle-orm/pg-core';
import { GST_DECLARATION_VERSION, type GstStateView } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { gstChecks, gstRepresentativeProofs } from '../../db/schema.js';
import { ConflictError, NotFoundError, ServiceUnavailableError, TooManyRequestsError, ValidationError } from '../../lib/errors.js';
import { grantGst, holderOf, lockBusinessRow } from './gst-grant.service.js';
import { getGstMode } from './gst-mode.js';
import { getGstProvider, type GstLookup } from './gst-provider.js';
import {
  OTP_RESEND_SECONDS,
  activeGstVerification,
  freshSql,
  getGstState,
  hasOfficerRevocation,
  openReview,
} from './gst-state.service.js';
import { parseGstin } from './gstin.js';

/**
 * GST path B, the instant path (F1 + A2 spec §5.2; textile `gst.service.ts` `lookupGst` / `confirmGst` and
 * `gst-proof.service.ts` `declare` / `sendGstOtp` / `verifyGstOtp`): lookup → declare → registered-contact code →
 * confirm. Business actions are rows (`gst_checks`, `gst_representative_proofs`), never `audit_log` (§5.6).
 *
 * Every step opens one transaction that locks the business row first (`lockBusinessRow`), so a business's lookups,
 * code sends and confirms run one at a time and the review submission (Task 10) waits for them, and vice versa.
 */

/** The declaration (§5.2 step 4). Its version lives in shared-types, so the API and the app can't drift apart. */
export const DECLARATION_VERSION = GST_DECLARATION_VERSION;
export const DECLARATION_TEXT = 'I am the proprietor, partner, director or authorised signatory of this business';

/** §5.2's numbers. */
export const LOOKUPS_PER_DAY = 5;
export const OTP_MAX_SENDS = 3;
export const OTP_MAX_ATTEMPTS = 5;

export interface GstActor {
  userId: string;
  businessId: string;
}

type CheckRow = typeof gstChecks.$inferSelect;
type ProofRow = typeof gstRepresentativeProofs.$inferSelect;

/**
 * §5.2 "Who may start", checked first by lookup, declare and code-send, **before any provider call**, in order:
 * mode `review` or an officer revocation ever → `409 GST_REVIEW_ONLY` (a revoked business never makes the provider
 * send a code to the real registered contact); an active `gst` verification → `409 GST_ALREADY_VERIFIED`; an open
 * review → `409 GST_REVIEW_OPEN`.
 */
export async function assertMayStartInstant(tx: Db | Tx, businessId: string): Promise<void> {
  if (getGstMode() === 'review' || (await hasOfficerRevocation(tx, businessId))) {
    throw new ConflictError('GST can only be verified by our team for this business. Send your documents for review.', 'GST_REVIEW_ONLY');
  }
  if ((await activeGstVerification(tx, businessId)) !== null) {
    throw new ConflictError('Your GST is already verified', 'GST_ALREADY_VERIFIED');
  }
  if ((await openReview(tx, businessId)) !== null) throw reviewOpen();
}

function reviewOpen(): ConflictError {
  return new ConflictError('Your GST documents are under review', 'GST_REVIEW_OPEN');
}

function lookupExpired(): ConflictError {
  return new ConflictError('Your lookup expired. Look it up again.', 'GST_LOOKUP_EXPIRED');
}

function proofClosed(): ConflictError {
  return new ConflictError('This attempt is closed. Look up your GSTIN again.', 'GST_PROOF_CLOSED');
}

/**
 * 5 business lookups per calendar day in India time (§5.2 step 2), counted on `gst_checks` on the database clock:
 * `source = business` rows whose result isn't `failed`, so officer lookups and provider outages never use up the day.
 * Over the limit → `429 GST_LOOKUP_LIMIT` with `details.retryAt` = the next midnight in India. The caller holds the
 * business row lock, so two lookups can't both take the last one.
 */
async function assertLookupAllowance(tx: Tx, businessId: string): Promise<void> {
  const { rows } = await tx.execute<{ used: number; retry_at: string }>(sql`
    WITH today AS (SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS start)
    SELECT
      (SELECT count(*)::int FROM ${gstChecks}, today
        WHERE ${gstChecks.businessId} = ${businessId}
          AND ${gstChecks.source} = 'business'
          AND ${gstChecks.result} <> 'failed'
          AND ${gstChecks.createdAt} >= today.start
          AND ${gstChecks.createdAt} < today.start + interval '1 day') AS used,
      to_json((SELECT start + interval '1 day' FROM today))#>>'{}' AS retry_at
  `);
  const row = rows[0]!;
  if (Number(row.used) >= LOOKUPS_PER_DAY) {
    throw new TooManyRequestsError("You've used today's 5 lookups. Try again tomorrow.", 'GST_LOOKUP_LIMIT', {
      retryAt: new Date(row.retry_at).toISOString(),
    });
  }
}

/** One lookup row (§5.6). A held GSTIN is `held` whatever its status, so nothing about it reaches this business. */
async function recordCheck(tx: Tx, actor: GstActor, gstin: string, lookup: GstLookup): Promise<CheckRow> {
  const base = { businessId: actor.businessId, userId: actor.userId, gstin, source: 'business' as const };
  let values: PgInsertValue<typeof gstChecks>;
  if (lookup.kind === 'unavailable') values = { ...base, result: 'failed', resolvedAt: null };
  else if (lookup.kind === 'not_found') values = { ...base, result: 'not_found', resolvedAt: sql`now()` };
  else {
    const held = (await holderOf(tx, gstin, actor.businessId)) !== null;
    values = {
      ...base,
      result: held ? 'held' : lookup.details.status === 'active' ? 'found' : 'status_refused',
      providerRef: lookup.ref,
      gstStatus: lookup.details.status,
      details: lookup.details,
      resolvedAt: sql`now()`,
    };
  }
  const [row] = await tx.insert(gstChecks).values(values).returning();
  return row!;
}

/**
 * §5.2 steps 1–3: `400 GSTIN_INVALID` before anything else; then (business row locked) the start rule, the daily
 * limit, the provider lookup and a `gst_checks` row. Nothing is reserved or granted. Returns the new state.
 */
export async function lookupGst(db: Db, actor: GstActor, input: string): Promise<GstStateView> {
  const gstin = parseGstin(input);
  return db.transaction(async (tx) => {
    await lockBusinessRow(tx, actor.businessId);
    await assertMayStartInstant(tx, actor.businessId);
    await assertLookupAllowance(tx, actor.businessId);
    const lookup = await getGstProvider().lookup(gstin);
    await recordCheck(tx, actor, gstin, lookup);
    return getGstState(tx, actor.businessId);
  });
}

/**
 * §5.2 step 4: the declaration on a `found`, fresh lookup of this business (else `404` / `409 GST_CHECK_NOT_USABLE` /
 * `409 GST_LOOKUP_EXPIRED`). A proof still open on the lookup is reused, so declaring again never resets the code
 * limits; a spent one means a new lookup (`409 GST_PROOF_CLOSED`).
 */
export async function declare(db: Db, actor: GstActor, checkId: string): Promise<GstStateView> {
  return db.transaction(async (tx) => {
    await lockBusinessRow(tx, actor.businessId);
    await assertMayStartInstant(tx, actor.businessId);
    const [check] = await tx
      .select({ id: gstChecks.id, gstin: gstChecks.gstin, result: gstChecks.result, fresh: freshSql })
      .from(gstChecks)
      .where(and(eq(gstChecks.id, checkId), eq(gstChecks.businessId, actor.businessId), eq(gstChecks.source, 'business')));
    if (!check) throw new NotFoundError('GST lookup');
    if (check.result !== 'found') throw new ConflictError("This lookup can't be confirmed", 'GST_CHECK_NOT_USABLE');
    if (!check.fresh) throw lookupExpired();

    const [existing] = await tx
      .select()
      .from(gstRepresentativeProofs)
      .where(and(eq(gstRepresentativeProofs.checkId, check.id), ne(gstRepresentativeProofs.status, 'rejected')))
      .orderBy(sql`${gstRepresentativeProofs.createdAt} DESC`)
      .limit(1)
      .for('update');
    if (existing) {
      if (existing.status !== 'declared' && existing.status !== 'code_sent') throw proofClosed();
      await tx
        .update(gstRepresentativeProofs)
        .set({ declarationVersion: DECLARATION_VERSION, declaredAt: sql`now()`, userId: actor.userId, updatedAt: sql`now()` })
        .where(eq(gstRepresentativeProofs.id, existing.id));
    } else {
      await tx.insert(gstRepresentativeProofs).values({
        checkId: check.id,
        businessId: actor.businessId,
        userId: actor.userId,
        gstin: check.gstin,
        declarationVersion: DECLARATION_VERSION,
        method: 'provider_otp',
        status: 'declared',
      });
    }
    return getGstState(tx, actor.businessId);
  });
}

/** This business's proof, locked; `404` otherwise. */
async function lockOwnProof(tx: Tx, actor: GstActor, proofId: string): Promise<ProofRow> {
  const [proof] = await tx
    .select()
    .from(gstRepresentativeProofs)
    .where(and(eq(gstRepresentativeProofs.id, proofId), eq(gstRepresentativeProofs.businessId, actor.businessId)))
    .for('update');
  if (!proof) throw new NotFoundError('GST attempt');
  return proof;
}

/** The proof's lookup with its freshness; `GST_LOOKUP_EXPIRED` when it's older than 30 minutes. */
async function freshCheckOf(tx: Tx, proof: ProofRow) {
  if (!proof.checkId) throw proofClosed();
  const [check] = await tx
    .select({ id: gstChecks.id, gstin: gstChecks.gstin, result: gstChecks.result, gstStatus: gstChecks.gstStatus, details: gstChecks.details, fresh: freshSql })
    .from(gstChecks)
    .where(eq(gstChecks.id, proof.checkId));
  if (!check || check.result !== 'found' || check.gstStatus !== 'active' || !check.details) {
    throw new ConflictError("This lookup can't be confirmed", 'GST_CHECK_NOT_USABLE');
  }
  if (!check.fresh) throw lookupExpired();
  return { ...check, details: check.details };
}

/**
 * §5.2 step 5: the provider sends a code to the GSTIN's registered contact; we keep its reference and the masked
 * hint. 3 sends per proof (`409 GST_OTP_LIMIT`), 30 s apart (`429 GST_OTP_TOO_SOON` with `details.retryAt`), only on
 * a fresh lookup. A provider outage is `503 GST_UNAVAILABLE` and uses up no send.
 */
export async function sendGstCode(db: Db, actor: GstActor, proofId: string): Promise<GstStateView> {
  return db.transaction(async (tx) => {
    await lockBusinessRow(tx, actor.businessId);
    await assertMayStartInstant(tx, actor.businessId);
    const proof = await lockOwnProof(tx, actor, proofId);
    if (proof.status !== 'declared' && proof.status !== 'code_sent') throw proofClosed();
    const check = await freshCheckOf(tx, proof);
    if (proof.otpSends >= OTP_MAX_SENDS) {
      throw new ConflictError('No more codes can be sent for this attempt. Look up your GSTIN again.', 'GST_OTP_LIMIT');
    }
    if (proof.lastOtpSentAt) {
      const { rows } = await tx.execute<{ wait: boolean; retry_at: string }>(sql`
        SELECT ${proof.lastOtpSentAt.toISOString()}::timestamptz + make_interval(secs => ${OTP_RESEND_SECONDS}::int) > now() AS wait,
               to_json(${proof.lastOtpSentAt.toISOString()}::timestamptz + make_interval(secs => ${OTP_RESEND_SECONDS}::int))#>>'{}' AS retry_at
      `);
      const row = rows[0]!;
      if (row.wait) {
        throw new TooManyRequestsError('Wait a few seconds before asking for another code', 'GST_OTP_TOO_SOON', {
          retryAt: new Date(row.retry_at).toISOString(),
        });
      }
    }

    const sent = await getGstProvider().sendContactOtp(check.gstin);
    if ('kind' in sent) throw new ServiceUnavailableError("We couldn't reach the GST service. Try again.", 'GST_UNAVAILABLE');
    await tx
      .update(gstRepresentativeProofs)
      .set({
        method: 'provider_otp',
        status: 'code_sent',
        otpRef: sent.ref,
        otpHint: sent.hint,
        otpSends: sql`${gstRepresentativeProofs.otpSends} + 1`,
        lastOtpSentAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(gstRepresentativeProofs.id, proof.id));
    return getGstState(tx, actor.businessId);
  });
}

type VerifyOutcome = { kind: 'granted'; state: GstStateView } | { kind: 'wrong'; attemptsLeft: number } | { kind: 'spent' };

/**
 * §5.2 steps 5–6: in one transaction that locks the business row first: `409 GST_REVIEW_OPEN` while a review is
 * `waiting` / `needs_more` (a late code can't verify a business whose review waits); `409 GST_PROOF_CLOSED` unless the
 * proof is `code_sent`; `409 GST_LOOKUP_EXPIRED` past 30 minutes; `409 GST_REVIEW_ONLY` in mode `review` or after an
 * officer revocation. A wrong code is counted (and kept) → `400 GST_OTP_INVALID`; the 5th wrong code spends the proof
 * → `409 GST_OTP_LIMIT`. A right code → `grantGst`.
 */
export async function verifyGstCode(db: Db, actor: GstActor, proofId: string, code: string): Promise<GstStateView> {
  const outcome = await db.transaction(async (tx): Promise<VerifyOutcome> => {
    await lockBusinessRow(tx, actor.businessId);
    if ((await openReview(tx, actor.businessId)) !== null) throw reviewOpen();
    const proof = await lockOwnProof(tx, actor, proofId);
    if (proof.status !== 'code_sent' || proof.otpRef === null) throw proofClosed();
    const check = await freshCheckOf(tx, proof);
    if (getGstMode() === 'review' || (await hasOfficerRevocation(tx, actor.businessId))) {
      throw new ConflictError('GST can only be verified by our team for this business. Send your documents for review.', 'GST_REVIEW_ONLY');
    }

    if (!(await getGstProvider().verifyContactOtp(proof.otpRef, code))) {
      const attempts = proof.otpAttempts + 1;
      const spent = attempts >= OTP_MAX_ATTEMPTS;
      await tx
        .update(gstRepresentativeProofs)
        .set({ otpAttempts: attempts, ...(spent ? { status: 'spent' as const } : {}), updatedAt: sql`now()` })
        .where(eq(gstRepresentativeProofs.id, proof.id));
      return spent ? { kind: 'spent' } : { kind: 'wrong', attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
    }

    await grantGst(tx, {
      businessId: actor.businessId,
      gstin: check.gstin,
      details: check.details,
      method: 'provider_otp',
      proofId: proof.id,
      replaceHeld: false,
    });
    return { kind: 'granted', state: await getGstState(tx, actor.businessId) };
  });

  // Refusals that must keep their writes (the counted attempt) are thrown after the commit.
  if (outcome.kind === 'wrong') {
    throw new ValidationError('That code is wrong', { attemptsLeft: outcome.attemptsLeft }, 'GST_OTP_INVALID');
  }
  if (outcome.kind === 'spent') {
    throw new ConflictError('Too many wrong codes. Look up your GSTIN again.', 'GST_OTP_LIMIT');
  }
  return outcome.state;
}
