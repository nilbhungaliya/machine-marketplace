import { inArray, or } from 'drizzle-orm';
import type { AdminRole } from '@mpm/shared-types';
import { db } from '../../src/db/index.js';
import { adminUsers, auditLog, searchRefreshJobs, searchSynonyms, searchTrendingHidden } from '../../src/db/schema.js';
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

/**
 * Deletes the rows that reference the admins first (audit_log; F4 + F5: the search refresh jobs their catalogue edits
 * queued, synonyms they created or edited, queries they hid from trending), then the admins.
 */
export async function deleteTestAdmins(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(auditLog).where(inArray(auditLog.adminId, ids));
  await db.delete(searchRefreshJobs).where(inArray(searchRefreshJobs.createdBy, ids));
  await db.delete(searchSynonyms).where(or(inArray(searchSynonyms.createdBy, ids), inArray(searchSynonyms.updatedBy, ids)));
  await db.delete(searchTrendingHidden).where(inArray(searchTrendingHidden.createdBy, ids));
  await db.delete(adminUsers).where(inArray(adminUsers.id, ids));
}
