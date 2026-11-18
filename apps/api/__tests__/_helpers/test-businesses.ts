import { eq, inArray } from 'drizzle-orm';
import type { BusinessActivity } from '@mpm/shared-types';
import { db } from '../../src/db/index.js';
import { businessVerifications, businesses, gstChecks, gstRepresentativeProofs, users } from '../../src/db/schema.js';
import { signUserToken } from '../../src/plugins/auth.js';
import { completeProfile, signInWithPhone } from '../../src/services/user.service.js';
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
 * Signs a new user in (`signInWithPhone`) and onboards them (`completeProfile`), then sets the business's activities
 * (default `['buy']`) and, when given, its pincode. Remove with `deleteTestBusinesses([businessId])`.
 */
export async function createTestBusinessUser(
  opts: { activities?: BusinessActivity[]; pincode?: string } = {},
): Promise<TestBusinessUser> {
  const phone = uniqueTestPhone();
  const signIn = await signInWithPhone(db, phone);
  const suffix = `${Date.now()}${seq++}`;
  const profile = await completeProfile(db, signIn.user.id, { name: 'Test Owner', businessName: `Test Works ${suffix}` });
  const businessId = profile.businessId;
  await db
    .update(businesses)
    .set({ activities: opts.activities ?? ['buy'], pincode: opts.pincode ?? null })
    .where(eq(businesses.id, businessId));
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
