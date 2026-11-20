import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Redis } from 'ioredis';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { adminPasswordProblem, type AdminPasswordLink, type AdminUser, type PasswordLinkInfo } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { adminPasswordTokens, adminUsers } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { runTx, type TxApp } from '../../lib/tx-effects.js';
import { AdminSessionEndedError, signAdminToken, type AdminTokenPayload } from '../../plugins/auth.js';
import { writeAudit } from '../audit.service.js';
import { clearLoginFailures } from './lockout.js';
import { endAdminSessions } from './sessions.js';

/**
 * Password links, password change and sign out everywhere (admin close-out §11.2, R15, plan D11, D13).
 *
 * A link is 32 random bytes (base64url), returned once and never stored, logged or audited: the row keeps its SHA-256
 * hex only. It works once, for `ADMIN_LINK_HOURS` (48 h), and only the newest link of an admin works (issuing one marks
 * the others used). The token travels in the panel's URL fragment and a POST body, never a query string.
 */

export const BCRYPT_COST = 12;

/**
 * Serialises every write to `admin_users` (plan D12): the last-super-admin guard counts after the change under this
 * lock, so two super admins demoting, deactivating or resetting each other at once leave one. Call first in the tx.
 */
export async function lockAdminUsers(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('admin_users'))`);
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function linkInvalid(): ValidationError {
  return new ValidationError('This link has expired or was already used. Ask a super admin for a new one.', undefined, 'PASSWORD_LINK_INVALID');
}

function passwordTooWeak(problem: string): ValidationError {
  return new ValidationError('Use 12 to 128 characters, and not your email address.', { field: 'password', problem }, 'PASSWORD_TOO_WEAK');
}

/** `400 PASSWORD_TOO_WEAK` unless the password is 12–128 characters and not the email. */
function checkPassword(password: string, email: string): void {
  const problem = adminPasswordProblem(password, email);
  if (problem) throw passwordTooWeak(problem);
}

/** Issues a link for an admin (the caller holds `lockAdminUsers`): the admin's other unused links stop working. */
export async function createPasswordLink(
  tx: Tx,
  adminId: string,
  purpose: 'invite' | 'reset',
  createdBy: string | null,
): Promise<AdminPasswordLink> {
  const token = randomBytes(32).toString('base64url');
  await tx
    .update(adminPasswordTokens)
    .set({ usedAt: sql`now()` })
    .where(and(eq(adminPasswordTokens.adminId, adminId), isNull(adminPasswordTokens.usedAt)));
  const [row] = await tx
    .insert(adminPasswordTokens)
    .values({
      adminId,
      tokenHash: hashLinkToken(token),
      purpose,
      expiresAt: sql`now() + interval '48 hours'`,
      createdByAdminId: createdBy,
    })
    .returning({ expiresAt: adminPasswordTokens.expiresAt });
  return { token, expiresAt: row!.expiresAt.toISOString() };
}

interface LiveLink {
  tokenId: string;
  adminId: string;
  purpose: 'invite' | 'reset';
  name: string;
  email: string;
}

/**
 * The link's row if it is usable: known, unused, unexpired, and its admin active (D11: a deactivated admin's link is
 * invalid). `lock` takes the token row `FOR UPDATE` (set password), so two uses of one link run one after the other.
 */
async function liveLink(conn: Db | Tx, token: string, lock: boolean): Promise<LiveLink> {
  if (token.length < 20 || token.length > 200) throw linkInvalid();
  const { rows } = await conn.execute<{ token_id: string; admin_id: string; purpose: 'invite' | 'reset'; name: string; email: string }>(sql`
    SELECT t.id AS token_id, t.admin_id, t.purpose, a.name, a.email
      FROM admin_password_tokens t
      JOIN admin_users a ON a.id = t.admin_id
     WHERE t.token_hash = ${hashLinkToken(token)}
       AND t.used_at IS NULL
       AND t.expires_at > now()
       AND a.is_active
     ${lock ? sql`FOR UPDATE OF t` : sql``}`);
  const r = rows[0];
  if (!r) throw linkInvalid();
  return { tokenId: r.token_id, adminId: r.admin_id, purpose: r.purpose, name: r.name, email: r.email };
}

/** Who the link is for (the set-password page shows it), or `400 PASSWORD_LINK_INVALID`. */
export async function inspectPasswordLink(conn: Db | Tx, token: string): Promise<PasswordLinkInfo> {
  const link = await liveLink(conn, token, false);
  return { name: link.name, email: link.email, purpose: link.purpose };
}

/**
 * Sets the password from a link: the link is used up, the admin's sessions end (any panel still open signs in again),
 * every login lock of the email is cleared after commit, and `admin_user.password_set` is written by that admin (no
 * value of the password or the link). The link is checked and the password hashed before the `admin_users` lock (no
 * bcrypt under the global lock); under it the token row is re-read `FOR UPDATE` and must still be usable and the same.
 */
export async function setPasswordFromLink(
  app: TxApp & { redis?: Redis },
  input: { token: string; password: string },
): Promise<{ email: string }> {
  const checked = await liveLink(app.db, input.token, false);
  checkPassword(input.password, checked.email);
  const hash = await bcrypt.hash(input.password, BCRYPT_COST);
  const result = await runTx(app, async (tx) => {
    await lockAdminUsers(tx);
    const link = await liveLink(tx, input.token, true);
    if (link.tokenId !== checked.tokenId || link.email !== checked.email) throw linkInvalid();
    await tx
      .update(adminUsers)
      .set({ passwordHash: hash, passwordSetAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(adminUsers.id, link.adminId));
    await tx.update(adminPasswordTokens).set({ usedAt: sql`now()` }).where(eq(adminPasswordTokens.id, link.tokenId));
    await endAdminSessions(tx, link.adminId);
    await writeAudit(tx, {
      adminId: link.adminId,
      action: 'admin_user.password_set',
      entityType: 'admin_user',
      entityId: link.adminId,
      before: null,
      after: { purpose: link.purpose },
    });
    return { email: link.email };
  });
  await clearLoginFailures(app.redis, result.email);
  return result;
}

/**
 * The signed-in admin changes their own password: `400 PASSWORD_WRONG` for a wrong current one, `400
 * PASSWORD_TOO_WEAK` for a weak new one. Every session ends, and the caller gets a fresh token of the new version so
 * the tab that changed it keeps working (it ignores the `admin:session_ended` carrying that same version, plan D2).
 * bcrypt runs before the `admin_users` lock; under it the row is re-read and its hash and token version must be the
 * ones checked, else `401 ADMIN_SESSION_ENDED` (another change got there first; nothing was written).
 */
export async function changePassword(
  app: TxApp,
  admin: AdminTokenPayload,
  input: { current: string; password: string },
): Promise<{ token: string; user: AdminUser }> {
  const readRow = async (conn: Db | Tx) => {
    const [row] = await conn.select().from(adminUsers).where(eq(adminUsers.id, admin.adminId));
    if (!row || !row.isActive || row.passwordHash === null || row.tokenVersion !== admin.tv) throw new AdminSessionEndedError();
    return row as typeof row & { passwordHash: string };
  };
  const checked = await readRow(app.db);
  if (!(await bcrypt.compare(input.current, checked.passwordHash))) {
    throw new ValidationError('The current password is wrong.', { field: 'current' }, 'PASSWORD_WRONG');
  }
  checkPassword(input.password, checked.email);
  const hash = await bcrypt.hash(input.password, BCRYPT_COST);
  return runTx(app, async (tx) => {
    await lockAdminUsers(tx);
    const row = await readRow(tx);
    if (row.passwordHash !== checked.passwordHash) throw new AdminSessionEndedError();
    await tx
      .update(adminUsers)
      .set({ passwordHash: hash, passwordSetAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(adminUsers.id, row.id));
    const tv = await endAdminSessions(tx, row.id);
    await writeAudit(tx, {
      adminId: row.id,
      action: 'admin_user.password_change',
      entityType: 'admin_user',
      entityId: row.id,
      before: null,
      after: null,
    });
    return {
      token: signAdminToken({ adminId: row.id, role: row.role, tv }),
      user: { id: row.id, name: row.name, email: row.email, role: row.role },
    };
  });
}

/** Ends every session of the signed-in admin, this one included (audit `admin_user.sign_out` on themselves). */
export async function signOutEverywhere(app: TxApp, admin: AdminTokenPayload): Promise<{ ok: true }> {
  return runTx(app, async (tx) => {
    await endAdminSessions(tx, admin.adminId);
    await writeAudit(tx, {
      adminId: admin.adminId,
      action: 'admin_user.sign_out',
      entityType: 'admin_user',
      entityId: admin.adminId,
      before: null,
      after: null,
    });
    return { ok: true as const };
  });
}
