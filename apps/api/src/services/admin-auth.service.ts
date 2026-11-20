import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import type { AdminUser } from '@mpm/shared-types';
import type { Db } from '../db/index.js';
import { adminUsers } from '../db/schema.js';
import { UnauthorizedError } from '../lib/errors.js';
import { signAdminToken } from '../plugins/auth.js';

export async function loginAdmin(
  db: Db,
  email: string,
  password: string,
): Promise<{ token: string; user: AdminUser }> {
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.email, email.toLowerCase()));
  // Same error for an unknown email, a wrong password, a deactivated admin and one with no password (invited, or a
  // reset link out: admin close-out §11.1), so the form can't probe accounts.
  if (!row || !row.isActive || row.passwordHash === null || !(await bcrypt.compare(password, row.passwordHash))) {
    throw new UnauthorizedError('Invalid email or password');
  }
  await db.update(adminUsers).set({ lastLoginAt: sql`now()` }).where(eq(adminUsers.id, row.id));
  return {
    token: signAdminToken({ adminId: row.id, role: row.role, tv: row.tokenVersion }),
    user: { id: row.id, name: row.name, email: row.email, role: row.role },
  };
}
