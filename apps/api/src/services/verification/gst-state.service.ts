import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { GstDetails, GstStateView } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businessVerifications, businesses, gstChecks, gstRepresentativeProofs } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { isStorageConfigured } from '../../lib/storage.js';
import { getGstMode } from './gst-mode.js';

/**
 * What the app shows for a business's GST (F1 + A2 spec §5.5; textile `gst.service.ts` `getGstState`), and the
 * history reads the instant path's start rule needs (§5.2 "Who may start", §5.4). Nothing here writes.
 */

/** A lookup can be confirmed for this long after the provider answered (§5.2 step 6). */
export const LOOKUP_FRESH_MINUTES = 30;
/** Seconds between two code sends on one proof (§5.2 step 5). */
export const OTP_RESEND_SECONDS = 30;

/** The review states that block the instant path and a second review (§5.2, §5.3). */
export const OPEN_REVIEW_STATUSES = ['waiting', 'needs_more'] as const;

export function noBusiness(): AppError {
  return new AppError("You haven't set up your business yet", 404, 'NO_BUSINESS');
}

/** `resolved_at` within the last 30 minutes, on the database clock. False for a lookup that never resolved. */
export const freshSql = sql<boolean>`(${gstChecks.resolvedAt} IS NOT NULL AND ${gstChecks.resolvedAt} > now() - make_interval(mins => ${LOOKUP_FRESH_MINUTES}::int))`;

/**
 * Whether the business has **ever** had an officer revocation (§5.4): the instant path is closed for good once it has.
 * Reads the history, never the current state, so no later reject, release or re-approval reopens it.
 */
export async function hasOfficerRevocation(conn: Db | Tx, businessId: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: businessVerifications.id })
    .from(businessVerifications)
    .where(and(eq(businessVerifications.businessId, businessId), eq(businessVerifications.revocationSource, 'officer')))
    .limit(1);
  return row !== undefined;
}

/** The active `gst` verification row, if any. */
export async function activeGstVerification(conn: Db | Tx, businessId: string) {
  const [row] = await conn
    .select()
    .from(businessVerifications)
    .where(
      and(
        eq(businessVerifications.businessId, businessId),
        eq(businessVerifications.level, 'gst'),
        eq(businessVerifications.status, 'active'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The business's open review (`waiting` or `needs_more`); at most one exists (`gst_proofs_one_open_review_uq`). */
export async function openReview(conn: Db | Tx, businessId: string) {
  const [row] = await conn
    .select()
    .from(gstRepresentativeProofs)
    .where(and(eq(gstRepresentativeProofs.businessId, businessId), inArray(gstRepresentativeProofs.status, [...OPEN_REVIEW_STATUSES])))
    .limit(1);
  return row ?? null;
}

const iso = (d: Date | null | undefined): string | undefined => (d ? d.toISOString() : undefined);

/**
 * GET /businesses/me/gst (§5.5). In order:
 * 1. an active `gst` verification → `verified` (the details it was granted with);
 * 2. an open review → `under_review` / `needs_more` (with the officer's message);
 * 3. otherwise the newest of the latest officer revocation (`revoked`), rejected review (`rejected`) and business
 *    lookup decides. A lookup reads as its outcome: `found` (needs Yes, or declared), `code_sent`, or `none` with
 *    `held` / `notFound` / `statusRefused` / `providerUnavailable`. A `found` lookup older than 30 minutes, or a
 *    `code_sent` proof whose lookup is, reads `none` + `expired` (nothing is written).
 * A held lookup carries no details: nothing about another business reaches this one.
 */
export async function getGstState(conn: Db | Tx, businessId: string): Promise<GstStateView> {
  const [business] = await conn.select({ gstin: businesses.gstin }).from(businesses).where(eq(businesses.id, businessId));
  if (!business) throw noBusiness();
  const mode = getGstMode();
  const base: GstStateView = {
    mode,
    state: 'none',
    instantAllowed: mode !== 'review' && !(await hasOfficerRevocation(conn, businessId)),
    storageAvailable: isStorageConfigured(),
  };

  // 1. Verified: the details come from the proof it was granted with (officer-approved, else its lookup).
  const [active] = await conn
    .select({
      verifiedAt: businessVerifications.verifiedAt,
      approvedDetails: gstRepresentativeProofs.approvedDetails,
      checkDetails: gstChecks.details,
    })
    .from(businessVerifications)
    .leftJoin(gstRepresentativeProofs, eq(gstRepresentativeProofs.id, businessVerifications.verifiedByProofId))
    .leftJoin(gstChecks, eq(gstChecks.id, gstRepresentativeProofs.checkId))
    .where(
      and(
        eq(businessVerifications.businessId, businessId),
        eq(businessVerifications.level, 'gst'),
        eq(businessVerifications.status, 'active'),
      ),
    )
    .limit(1);
  if (active) {
    const details: GstDetails | null = active.approvedDetails ?? active.checkDetails ?? null;
    return {
      ...base,
      state: 'verified',
      ...(business.gstin ? { gstin: business.gstin } : {}),
      ...(details ? { details } : {}),
      verifiedAt: active.verifiedAt.toISOString(),
    };
  }

  // 2. An open review.
  const open = await openReview(conn, businessId);
  if (open) {
    return {
      ...base,
      state: open.status === 'needs_more' ? 'needs_more' : 'under_review',
      gstin: open.gstin,
      proofId: open.id,
      ...(open.checkId ? { checkId: open.checkId } : {}),
      ...(open.status === 'needs_more' && open.officerMessage ? { officerMessage: open.officerMessage } : {}),
    };
  }

  // 3. The newest of: a revocation, a rejected review, a lookup.
  const [revoked] = await conn
    .select({ at: businessVerifications.revokedAt, reason: businessVerifications.revokeReason })
    .from(businessVerifications)
    .where(
      and(
        eq(businessVerifications.businessId, businessId),
        eq(businessVerifications.level, 'gst'),
        eq(businessVerifications.status, 'revoked'),
      ),
    )
    .orderBy(desc(businessVerifications.revokedAt))
    .limit(1);
  const [rejected] = await conn
    .select({ at: gstRepresentativeProofs.decidedAt, reason: gstRepresentativeProofs.reason, gstin: gstRepresentativeProofs.gstin })
    .from(gstRepresentativeProofs)
    .where(and(eq(gstRepresentativeProofs.businessId, businessId), eq(gstRepresentativeProofs.status, 'rejected')))
    .orderBy(desc(gstRepresentativeProofs.decidedAt))
    .limit(1);
  const [check] = await conn
    .select({
      id: gstChecks.id,
      gstin: gstChecks.gstin,
      result: gstChecks.result,
      gstStatus: gstChecks.gstStatus,
      details: gstChecks.details,
      createdAt: gstChecks.createdAt,
      fresh: freshSql,
    })
    .from(gstChecks)
    .where(and(eq(gstChecks.businessId, businessId), eq(gstChecks.source, 'business')))
    .orderBy(desc(gstChecks.createdAt), desc(gstChecks.id))
    .limit(1);

  const time = (d: Date | null | undefined) => d?.getTime() ?? -Infinity;
  const newest = Math.max(time(revoked?.at), time(rejected?.at), time(check?.createdAt));
  if (newest === -Infinity) return base;
  if (revoked && time(revoked.at) === newest) {
    return { ...base, state: 'revoked', ...(business.gstin ? { gstin: business.gstin } : {}), ...(revoked.reason ? { reason: revoked.reason } : {}) };
  }
  if (rejected && time(rejected.at) === newest) {
    return { ...base, state: 'rejected', gstin: rejected.gstin, ...(rejected.reason ? { reason: rejected.reason } : {}) };
  }
  const c = check!;
  switch (c.result) {
    case 'held':
      return { ...base, gstin: c.gstin, held: true };
    case 'not_found':
      return { ...base, gstin: c.gstin, notFound: true };
    case 'failed':
      return { ...base, gstin: c.gstin, providerUnavailable: true };
    case 'status_refused':
      return { ...base, gstin: c.gstin, ...(c.gstStatus ? { statusRefused: c.gstStatus } : {}) };
    case 'found': {
      const [proof] = await conn
        .select()
        .from(gstRepresentativeProofs)
        .where(eq(gstRepresentativeProofs.checkId, c.id))
        .orderBy(desc(gstRepresentativeProofs.createdAt))
        .limit(1);
      // Spent (code limit) or passed and since revoked: a new lookup is needed.
      if (proof && proof.status !== 'declared' && proof.status !== 'code_sent') return { ...base, gstin: c.gstin };
      if (!c.fresh) return { ...base, gstin: c.gstin, expired: true };
      const found = { ...base, gstin: c.gstin, checkId: c.id, ...(c.details ? { details: c.details } : {}) };
      if (proof?.status === 'code_sent') {
        const resend = proof.lastOtpSentAt ? new Date(proof.lastOtpSentAt.getTime() + OTP_RESEND_SECONDS * 1000) : null;
        return {
          ...found,
          state: 'code_sent',
          proofId: proof.id,
          ...(proof.otpHint ? { hint: proof.otpHint } : {}),
          ...(resend ? { resendAvailableAt: iso(resend) } : {}),
        };
      }
      return { ...found, state: 'found', ...(proof ? { proofId: proof.id } : {}) };
    }
  }
}
