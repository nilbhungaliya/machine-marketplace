import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { businesses, users } from '../db/schema.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { signUserToken } from '../plugins/auth.js';

/**
 * Signs in (creating the user on first login). New = no name yet, so the app shows onboarding.
 * A suspended or blocked account (scope A2) is refused with `ACCOUNT_SUSPENDED`.
 */
export async function signInWithPhone(db: Db, phone: string) {
  const [existing] = await db.select().from(users).where(eq(users.phone, phone));
  if (existing && existing.status !== 'active') {
    throw new ForbiddenError('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
  }
  const user = existing ?? (await db.insert(users).values({ phone }).returning())[0];
  return {
    token: signUserToken({ userId: user.id, businessId: user.businessId }),
    user: { id: user.id, name: user.name, phone: user.phone },
    isNewUser: !user.name,
  };
}

/** Onboarding: sets the person's name and creates their business on first call. */
export async function completeProfile(db: Db, userId: string, input: { name: string; businessName: string }) {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    if (!user) throw new NotFoundError('User');

    let businessId = user.businessId;
    if (businessId) {
      await tx.update(businesses).set({ tradeName: input.businessName, updatedAt: new Date() }).where(eq(businesses.id, businessId));
    } else {
      const [biz] = await tx.insert(businesses).values({ tradeName: input.businessName }).returning({ id: businesses.id });
      businessId = biz.id;
    }

    const [updated] = await tx
      .update(users)
      .set({ name: input.name, businessId, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return { id: updated.id, name: updated.name, phone: updated.phone, businessId };
  });
}
