import { and, eq, ne, sql } from 'drizzle-orm';
import type { GstDetails } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businessVerifications, businesses, gstRepresentativeProofs } from '../../db/schema.js';
import { ConflictError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { activeGstVerification, noBusiness } from './gst-state.service.js';

/**
 * The single GST grant (F1 + A2 spec §5.2 step 6, §5.3 "Approve"; textile `gst.service.ts` `grantGst`). The instant
 * confirm (`verifyGstCode`) and the officer's approval (Task 10) both end here.
 *
 * Lock order, always: the business row (`SELECT … FOR UPDATE`, the lock `verifyGstCode` and the review submission take
 * first), then the GSTIN's advisory lock. Two businesses racing for one GSTIN each hold only their own row and then
 * queue on the GSTIN lock, so the second sees the first's committed GSTIN and gets `409 GSTIN_TAKEN`.
 */

/** Locks the business row until the transaction ends, and returns it. `404 NO_BUSINESS` when it's gone. */
export async function lockBusinessRow(tx: Tx, businessId: string) {
  const [row] = await tx.select().from(businesses).where(eq(businesses.id, businessId)).for('update');
  if (!row) throw noBusiness();
  return row;
}

/** Serializes everything that decides who holds a GSTIN, until the transaction ends. */
export async function lockGstin(tx: Tx, gstin: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`gstin:${gstin}`}))`);
}

/** The business that holds this GSTIN, other than `businessId`. */
export async function holderOf(conn: Db | Tx, gstin: string, businessId: string): Promise<string | null> {
  const [row] = await conn
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.gstin, gstin), ne(businesses.id, businessId)))
    .limit(1);
  return row?.id ?? null;
}

/** §5.2's "held" outcome: nothing about the other business. */
export function gstinTaken(): ConflictError {
  return new ConflictError("This GSTIN is already linked to an account. If it's yours, contact support.", 'GSTIN_TAKEN');
}

export interface GrantGstInput {
  businessId: string;
  gstin: string;
  details: GstDetails;
  /** `provider_otp`: the instant path; `officer_review`: an officer approved a review (Task 10). */
  method: 'provider_otp' | 'officer_review';
  /** The proof granted from: becomes `passed` (instant) or `approved` (officer) and `verified_by_proof_id`. */
  proofId: string;
  /** The approving officer (`officer_review`). */
  adminId?: string;
  /**
   * True when the business may hold a different GSTIN that this grant replaces (an officer approving a review for
   * another GSTIN after a revocation, §5.3 "A different GSTIN"). False on the instant path: a held, different GSTIN
   * there is refused (`409 GST_OTHER_GSTIN_HELD`).
   */
  replaceHeld: boolean;
}

/**
 * Writes the GSTIN and its fields on the business, adds `gst` to `verification_levels`, sets the stored summary to
 * `approved` (note cleared, `verified_at` now) and inserts the active `gst` verification. Takes its own locks (business
 * row, then GSTIN) and refuses: another holder → `409 GSTIN_TAKEN` (a unique violation on `businesses.gstin` maps to
 * the same); an active `gst` verification → `409 GST_ALREADY_VERIFIED`. The business's own name (`trade_name`) is left
 * alone: while GST is verified the shown name is the GST trade name read through `verified_by_proof_id`, and a
 * revocation hands the business its own name back (§4.1, §5.4). Returns the verification id.
 */
export async function grantGst(tx: Tx, input: GrantGstInput): Promise<string> {
  const { businessId, gstin, details } = input;
  const business = await lockBusinessRow(tx, businessId);
  await lockGstin(tx, gstin);

  if ((await holderOf(tx, gstin, businessId)) !== null) throw gstinTaken();
  if ((await activeGstVerification(tx, businessId)) !== null) {
    throw new ConflictError('Your GST is already verified', 'GST_ALREADY_VERIFIED');
  }
  if (business.gstin !== null && business.gstin !== gstin && !input.replaceHeld) {
    throw new ConflictError('This business holds another GSTIN', 'GST_OTHER_GSTIN_HELD');
  }

  const levels = business.verificationLevels.includes('gst') ? business.verificationLevels : [...business.verificationLevels, 'gst'];
  try {
    await tx
      .update(businesses)
      .set({
        gstin,
        pan: gstin.slice(2, 12),
        legalName: details.legalName,
        constitution: details.constitution,
        gstRegisteredOn: details.registeredOn,
        gstAddress: details.address,
        verificationLevels: levels,
        verificationStatus: 'approved',
        verificationNote: null,
        verifiedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(businesses.id, businessId));
  } catch (err) {
    // Only reachable by a writer that skipped the GSTIN lock: still a 409, never a 500.
    if (isUniqueViolation(err, 'businesses_gstin_unique')) throw gstinTaken();
    throw err;
  }

  const officer = input.method === 'officer_review';
  const [verification] = await tx
    .insert(businessVerifications)
    .values({
      businessId,
      level: 'gst',
      method: input.method,
      reason: officer ? 'GST verified: officer review' : 'GST verified: registered-contact code',
      verifiedByAdminId: input.adminId ?? null,
      verifiedByProofId: input.proofId,
    })
    .returning({ id: businessVerifications.id });

  await tx
    .update(gstRepresentativeProofs)
    .set(
      officer
        ? { status: 'approved', officerId: input.adminId ?? null, decidedAt: sql`now()`, updatedAt: sql`now()` }
        : { status: 'passed', passedAt: sql`now()`, updatedAt: sql`now()` },
    )
    .where(eq(gstRepresentativeProofs.id, input.proofId));

  return verification!.id;
}
