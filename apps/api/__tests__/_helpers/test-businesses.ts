import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { BusinessActivity, GstDetails, GstDocumentType, GstEnteredDetails, GstProofStatus } from '@mpm/shared-types';
import { db } from '../../src/db/index.js';
import { businessVerifications, businesses, gstChecks, gstRepresentativeProofs, users } from '../../src/db/schema.js';
import { signUserToken } from '../../src/plugins/auth.js';
import { updateMyProfile } from '../../src/services/business/profile.service.js';
import { signInWithPhone } from '../../src/services/user.service.js';
import { grantGst } from '../../src/services/verification/gst-grant.service.js';
import { DECLARATION_VERSION } from '../../src/services/verification/gst-instant.service.js';
import { gstStub } from '../../src/services/verification/gst-stub.js';
import { uniqueTestPhone } from './test-users.js';

let seq = 0;

export interface TestBusinessUser {
  userId: string;
  businessId: string;
  /** A user token that carries the business id. */
  token: string;
  phone: string;
}

/**
 * Signs a new user in (`signInWithPhone`) and onboards them the way the app does (`updateMyProfile`, the service behind
 * the first `PATCH /businesses/me`, which creates the business) with the given activities (default `['buy']`), then
 * sets the pincode when given. Remove with `deleteTestBusinesses([businessId])`.
 */
export async function createTestBusinessUser(
  opts: { activities?: BusinessActivity[]; pincode?: string } = {},
): Promise<TestBusinessUser> {
  const phone = uniqueTestPhone();
  const signIn = await signInWithPhone(db, phone);
  const suffix = `${Date.now()}${seq++}`;
  const profile = await updateMyProfile(db, signIn.user.id, {
    name: 'Test Owner',
    businessName: `Test Works ${suffix}`,
    activities: opts.activities ?? ['buy'],
  });
  const businessId = profile.id;
  if (opts.pincode) await db.update(businesses).set({ pincode: opts.pincode }).where(eq(businesses.id, businessId));
  return { userId: signIn.user.id, businessId, token: signUserToken({ userId: signIn.user.id, businessId }), phone };
}

/**
 * Deletes the businesses and everything that hangs off them, deepest foreign key first: verifications (they reference
 * proofs), representative proofs (they reference checks), GST checks, then the businesses' users, then the businesses.
 * Extend as tables that reference businesses are added. No-op for an empty list.
 */
export async function deleteTestBusinesses(businessIds: string[]): Promise<void> {
  if (businessIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.delete(businessVerifications).where(inArray(businessVerifications.businessId, businessIds));
    await tx.delete(gstRepresentativeProofs).where(inArray(gstRepresentativeProofs.businessId, businessIds));
    await tx.delete(gstChecks).where(inArray(gstChecks.businessId, businessIds));
    await tx.delete(users).where(inArray(users.businessId, businessIds));
    await tx.delete(businesses).where(inArray(businesses.id, businessIds));
  });
}

const GSTIN_BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let gstinSeq = 0;

/**
 * A valid GSTIN (format + checksum) unique per run: `24T` + 4 letters + 4 digits from the clock and a counter, then
 * `F1Z` and the check digit. Never one of the stub's fixed GSTINs (they start `24AAAC`), so the stub answers `active`.
 */
export function uniqueTestGstin(): string {
  const space = 26 ** 4 * 10_000;
  const n = (Date.now() * 100 + (gstinSeq++ % 100)) % space;
  let m = Math.floor(n / 10_000);
  let letters = '';
  for (let i = 0; i < 4; i++) {
    letters = LETTERS.charAt(m % 26) + letters;
    m = Math.floor(m / 26);
  }
  const body = `24T${letters}${String(n % 10_000).padStart(4, '0')}F1Z`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_BASE36.indexOf(body.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return body + GSTIN_BASE36.charAt((36 - (sum % 36)) % 36);
}

/**
 * Verifies a business on a GSTIN the way the instant path does (a `found` check, a proof, then `grantGst`), without
 * the HTTP steps. The check is a `business` lookup, so it counts toward that business's day. Returns the ids.
 */
export async function grantTestGst(
  businessId: string,
  gstin: string = uniqueTestGstin(),
): Promise<{ gstin: string; checkId: string; proofId: string; details: GstDetails }> {
  const lookup = await gstStub.lookup(gstin);
  if (lookup.kind !== 'found') throw new Error(`grantTestGst: the stub didn't find ${gstin}`);
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.businessId, businessId)).limit(1);
  if (!owner) throw new Error('grantTestGst: the business has no user');
  return db.transaction(async (tx) => {
    const [check] = await tx
      .insert(gstChecks)
      .values({
        businessId,
        userId: owner.id,
        gstin,
        source: 'business',
        result: 'found',
        providerRef: lookup.ref,
        gstStatus: lookup.details.status,
        details: lookup.details,
        resolvedAt: sql`now()`,
      })
      .returning({ id: gstChecks.id });
    const [proof] = await tx
      .insert(gstRepresentativeProofs)
      .values({
        checkId: check!.id,
        businessId,
        userId: owner.id,
        gstin,
        declarationVersion: DECLARATION_VERSION,
        method: 'provider_otp',
        status: 'code_sent',
      })
      .returning({ id: gstRepresentativeProofs.id });
    await grantGst(tx, { businessId, gstin, details: lookup.details, method: 'provider_otp', proofId: proof!.id, replaceHeld: false });
    return { gstin, checkId: check!.id, proofId: proof!.id, details: lookup.details };
  });
}

/**
 * An officer revocation (spec §5.4) written directly, as Task 11's revoke will: the active `gst` row becomes
 * `revoked` with `revocation_source = officer`, `gst` leaves `verification_levels`, the summary is `rejected` with the
 * reason and `verified_at` is cleared. The GSTIN stays on the business.
 */
export async function revokeTestGst(businessId: string, reason = 'Test revocation'): Promise<void> {
  await db.transaction(async (tx) => {
    const revoked = await tx
      .update(businessVerifications)
      .set({ status: 'revoked', revokedAt: sql`now()`, revokeReason: reason, revocationSource: 'officer' })
      .where(
        and(
          eq(businessVerifications.businessId, businessId),
          eq(businessVerifications.level, 'gst'),
          eq(businessVerifications.status, 'active'),
        ),
      )
      .returning({ id: businessVerifications.id });
    if (revoked.length === 0) throw new Error('revokeTestGst: no active gst verification');
    const [b] = await tx.select({ levels: businesses.verificationLevels }).from(businesses).where(eq(businesses.id, businessId));
    await tx
      .update(businesses)
      .set({
        verificationLevels: b!.levels.filter((l) => l !== 'gst'),
        verificationStatus: 'rejected',
        verificationNote: reason,
        verifiedAt: null,
      })
      .where(eq(businesses.id, businessId));
  });
}

/** What a test review typed when no lookup is attached (the default). */
export function testEntered(overrides: Partial<GstEnteredDetails> = {}): GstEnteredDetails {
  return {
    legalName: 'Typed Engineering Pvt Ltd',
    tradeName: 'Typed Works',
    address: { line: 'Plot 12, GIDC Odhav', city: 'Ahmedabad', state: 'Gujarat', pincode: '382415' },
    constitution: 'Private Limited Company',
    ...overrides,
  };
}

/**
 * A review (spec §5.3) inserted directly, as `submitReview` leaves it, so officer-side tests run without R2: a
 * `documents` proof (default `waiting`) with fake `verification/<businessId>/<proofId>/<uuid>.<ext>` keys (a
 * certificate PDF and an ID JPEG), and the business's summary `pending`. `withCheck` attaches a `found` business lookup
 * from the stub (then `entered` is null); otherwise `entered` (default `testEntered()`). Returns the ids.
 */
export async function insertTestReview(
  businessId: string,
  opts: {
    gstin?: string;
    withCheck?: boolean;
    entered?: GstEnteredDetails;
    status?: Extract<GstProofStatus, 'waiting' | 'needs_more'>;
    documents?: Array<{ type: GstDocumentType; ext?: 'jpg' | 'png' | 'webp' | 'pdf' }>;
  } = {},
): Promise<{ proofId: string; gstin: string; checkId: string | null }> {
  const gstin = opts.gstin ?? uniqueTestGstin();
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.businessId, businessId)).limit(1);
  if (!owner) throw new Error('insertTestReview: the business has no user');
  const proofId = randomUUID();
  const docs = opts.documents ?? [
    { type: 'gst_certificate' as const, ext: 'pdf' as const },
    { type: 'id_proof' as const, ext: 'jpg' as const },
  ];
  const documents = docs.map((d) => ({ key: `verification/${businessId}/${proofId}/${randomUUID()}.${d.ext ?? 'pdf'}`, type: d.type }));
  return db.transaction(async (tx) => {
    let checkId: string | null = null;
    if (opts.withCheck) {
      const lookup = await gstStub.lookup(gstin);
      if (lookup.kind !== 'found') throw new Error(`insertTestReview: the stub didn't find ${gstin}`);
      const [check] = await tx
        .insert(gstChecks)
        .values({
          businessId,
          userId: owner.id,
          gstin,
          source: 'business',
          result: 'found',
          providerRef: lookup.ref,
          gstStatus: lookup.details.status,
          details: lookup.details,
          resolvedAt: sql`now()`,
        })
        .returning({ id: gstChecks.id });
      checkId = check!.id;
    }
    await tx.insert(gstRepresentativeProofs).values({
      id: proofId,
      checkId,
      businessId,
      userId: owner.id,
      gstin,
      declarationVersion: DECLARATION_VERSION,
      method: 'documents',
      status: opts.status ?? 'waiting',
      entered: checkId ? null : (opts.entered ?? testEntered()),
      documents,
    });
    await tx.update(businesses).set({ verificationStatus: 'pending', verificationNote: null }).where(eq(businesses.id, businessId));
    return { proofId, gstin, checkId };
  });
}
