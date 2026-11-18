import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import { ForbiddenError } from '../lib/errors.js';
import { signUserToken } from '../plugins/auth.js';
import { onboardingForUser } from './business/profile.service.js';

/**
 * Signs in (creating the user on first login). New = no name yet, so the app shows onboarding; `onboarding` says
 * which step it resumes at (`'profile'` while the user has no business, ruling R1). The business is created by the
 * first `PATCH /businesses/me` (`updateMyProfile`); there is no other way to create one.
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
    onboarding: await onboardingForUser(db, user),
  };
}
