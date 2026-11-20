import bcrypt from 'bcryptjs';
import { inArray, or } from 'drizzle-orm';
import type { AdminRole } from '@mpm/shared-types';
import { db } from '../../src/db/index.js';
import {
  adminPasswordTokens,
  adminUsers,
  auditLog,
  fraudSignals,
  searchRefreshJobs,
  searchSynonyms,
  searchTrendingHidden,
} from '../../src/db/schema.js';
import { signAdminToken } from '../../src/plugins/auth.js';

let seq = 0;

/**
 * Creates an admin with a unique (lowercase) email and a signed token carrying the row's `token_version` (`tv`).
 * - `password`: stored hashed (bcrypt cost 4, fast for tests); otherwise a placeholder hash nobody can sign in with.
 * - `invited`: no password at all (`password_hash` null, never signed in), as a fresh invite.
 * Delete with deleteTestAdmins.
 */
export async function createTestAdmin(
  role: AdminRole,
  opts: { password?: string; invited?: boolean } = {},
): Promise<{ id: string; email: string; token: string }> {
  const email = `test-admin-${Date.now()}-${seq++}@example.test`;
  const passwordHash = opts.invited ? null : opts.password ? await bcrypt.hash(opts.password, 4) : 'not-a-real-hash';
  const [row] = await db
    .insert(adminUsers)
    .values({ name: 'Test Admin', email, passwordHash, role, passwordSetAt: passwordHash ? new Date() : null })
    .returning({ id: adminUsers.id, tokenVersion: adminUsers.tokenVersion });
  return { id: row!.id, email, token: signAdminToken({ adminId: row!.id, role, tv: row!.tokenVersion }) };
}

/**
 * Deletes the rows that reference the admins first (audit_log; F4 + F5: the search refresh jobs their catalogue edits
 * queued, synonyms they created or edited, queries they hid from trending; admin close-out: their password links and
 * the links they issued), clears the references that stay (other admins they created or deactivated, signals they
 * reviewed), then the admins.
 */
export async function deleteTestAdmins(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(auditLog).where(inArray(auditLog.adminId, ids));
  await db.delete(searchRefreshJobs).where(inArray(searchRefreshJobs.createdBy, ids));
  await db.delete(searchSynonyms).where(or(inArray(searchSynonyms.createdBy, ids), inArray(searchSynonyms.updatedBy, ids)));
  await db.delete(searchTrendingHidden).where(inArray(searchTrendingHidden.createdBy, ids));
  await db
    .delete(adminPasswordTokens)
    .where(or(inArray(adminPasswordTokens.adminId, ids), inArray(adminPasswordTokens.createdByAdminId, ids)));
  await db.update(adminUsers).set({ createdByAdminId: null }).where(inArray(adminUsers.createdByAdminId, ids));
  await db.update(adminUsers).set({ deactivatedByAdminId: null }).where(inArray(adminUsers.deactivatedByAdminId, ids));
  await db.update(fraudSignals).set({ reviewedByAdminId: null }).where(inArray(fraudSignals.reviewedByAdminId, ids));
  await db.delete(adminUsers).where(inArray(adminUsers.id, ids));
}
