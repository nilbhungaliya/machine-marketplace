import { inArray } from 'drizzle-orm';
import type { AdminRole } from '@mpm/shared-types';
import { db } from '../../src/db/index.js';
import { adminUsers, auditLog } from '../../src/db/schema.js';
import { signAdminToken } from '../../src/plugins/auth.js';

let seq = 0;

/** Creates an admin with a unique email and a signed token. Delete with deleteTestAdmins. */
export async function createTestAdmin(role: AdminRole): Promise<{ id: string; token: string }> {
  const email = `test-admin-${Date.now()}-${seq++}@example.test`;
  const [row] = await db
    .insert(adminUsers)
    .values({ name: 'Test Admin', email, passwordHash: 'not-a-real-hash', role })
    .returning({ id: adminUsers.id });
  return { id: row!.id, token: signAdminToken({ adminId: row!.id, role }) };
}

/** Deletes the admins' audit_log rows first (foreign key), then the admins. */
export async function deleteTestAdmins(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(auditLog).where(inArray(auditLog.adminId, ids));
  await db.delete(adminUsers).where(inArray(adminUsers.id, ids));
}
