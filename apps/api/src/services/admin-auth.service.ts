import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
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
  // Same error for unknown email and wrong password, so the form can't probe accounts.
  if (!row || !row.isActive || !(await bcrypt.compare(password, row.passwordHash))) {
    throw new UnauthorizedError('Invalid email or password');
  }
  return {
    token: signAdminToken({ adminId: row.id, role: row.role }),
    user: { id: row.id, name: row.name, email: row.email, role: row.role },
  };
}
