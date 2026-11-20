import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { AdminUser } from '@mpm/shared-types';
import type { Db } from '../db/index.js';
import { adminUsers } from '../db/schema.js';
import { UnauthorizedError } from '../lib/errors.js';
import { signAdminToken } from '../plugins/auth.js';
import { countLoginAttempt, loginSucceeded } from './admin-users/lockout.js';

/**
 * A cost-12 bcrypt hash of a random value nobody knows. Compared against when the email is unknown, the admin is
 * deactivated or has no password, so every failed login does the same bcrypt work and the response time doesn't tell
 * which emails are admins (admin close-out R15).
 */
const DUMMY_HASH = '$2b$12$Pdjy2AS/KmNo0lpqtkc4RObKs.xKf7R/t6CqRDOsuYjeB37fOdsNu';

export async function loginAdmin(
  app: { db: Db; redis?: Redis },
  input: { email: string; password: string; ip: string },
): Promise<{ token: string; user: AdminUser }> {
  const address = input.email.trim().toLowerCase();
  // Lockout (`lockout.ts`): the attempt counts first, and a locked email (+ IP) is refused before any bcrypt work.
  await countLoginAttempt(app.redis, address, input.ip);
  const [row] = await app.db.select().from(adminUsers).where(eq(adminUsers.email, address));
  const usable = row !== undefined && row.isActive && row.passwordHash !== null;
  const matches = await bcrypt.compare(input.password, usable ? row.passwordHash! : DUMMY_HASH);
  // Same error for an unknown email, a wrong password, a deactivated admin and one with no password (invited, or a
  // reset link out: admin close-out §11.1), so the form can't probe accounts.
  if (!usable || !matches) throw new UnauthorizedError('Invalid email or password');
  await loginSucceeded(app.redis, address, input.ip);
  await app.db.update(adminUsers).set({ lastLoginAt: sql`now()` }).where(eq(adminUsers.id, row.id));
  return {
    token: signAdminToken({ adminId: row.id, role: row.role, tv: row.tokenVersion }),
    user: { id: row.id, name: row.name, email: row.email, role: row.role },
  };
}
