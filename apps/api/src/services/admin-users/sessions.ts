import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { adminUsers } from '../../db/schema.js';
import { NotFoundError } from '../../lib/errors.js';
import { queueAdminSessionEnd } from '../../lib/tx-effects.js';

/**
 * Ends every session of one admin (admin close-out R13, §11.1, plan D2): bumps `token_version`, so each token signed
 * before it answers `401 ADMIN_SESSION_ENDED` on its next request, and queues `admin:session_ended { tv }` plus the
 * socket drop for after commit (nothing happens if the transaction rolls back). Returns the new version, which a
 * caller signing a fresh token for the same admin (password change) puts in it.
 *
 * Callers: deactivate, reset link, role change, sign out, password set / change, sign out everywhere (A2). `tx` must
 * come from `runTx`.
 */
export async function endAdminSessions(tx: Tx, adminId: string): Promise<number> {
  const [row] = await tx
    .update(adminUsers)
    .set({ tokenVersion: sql`${adminUsers.tokenVersion} + 1` })
    .where(eq(adminUsers.id, adminId))
    .returning({ tokenVersion: adminUsers.tokenVersion });
  if (!row) throw new NotFoundError('Admin');
  queueAdminSessionEnd(tx, adminId, row.tokenVersion);
  return row.tokenVersion;
}
