import { eq, sql } from 'drizzle-orm';
import {
  adminUserStatus,
  type AdminPasswordLink,
  type AdminRole,
  type AdminUserCreateResult,
  type AdminUserRow,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { adminUsers } from '../../db/schema.js';
import { adminText } from '../../lib/admin-text.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { runTx, type TxApp } from '../../lib/tx-effects.js';
import { AdminSessionEndedError, type AdminTokenPayload } from '../../plugins/auth.js';
import { writeAudit } from '../audit.service.js';
import { createPasswordLink, lockAdminUsers } from './password-links.js';
import { endAdminSessions } from './sessions.js';

/**
 * AD7 admin users (admin close-out §11.2, R14, plan D11, D12, D15): super admins invite, edit, deactivate, reactivate,
 * reset and sign out other admins. Every write runs in `runTx` holding `lockAdminUsers` first; actions on yourself
 * (role, deactivate, reset, sign out) are `409 ADMIN_SELF_ACTION`; after the change, zero usable super admins (active,
 * with a password) is `409 ADMIN_LAST_SUPER_ADMIN` and rolls back. Every write writes one `admin_user.*` audit row whose
 * snapshot is `{ name, email, role, isActive }` (never a hash or a link). Admin rows are never deleted.
 */

type Actor = AdminTokenPayload;

type Row = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  is_active: boolean;
  has_password: boolean;
  last_login_at: Date | null;
  created_at: Date;
  deactivated_at: Date | null;
  created_by_id: string | null;
  created_by_name: string | null;
};

const SELECT = sql`
  SELECT a.id, a.name, a.email, a.role, a.is_active, (a.password_hash IS NOT NULL) AS has_password, a.last_login_at,
         a.created_at, a.deactivated_at, c.id AS created_by_id, c.name AS created_by_name
    FROM admin_users a
    LEFT JOIN admin_users c ON c.id = a.created_by_admin_id`;

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());

function toRow(r: Row): AdminUserRow {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    status: adminUserStatus({ isActive: r.is_active, hasPassword: r.has_password, lastLoginAt: r.last_login_at }),
    lastLoginAt: iso(r.last_login_at),
    createdAt: iso(r.created_at)!,
    createdBy: r.created_by_id ? { id: r.created_by_id, name: r.created_by_name ?? '' } : null,
    deactivatedAt: iso(r.deactivated_at),
  };
}

/** D15's snapshot: no hash, no link. */
function snapshot(r: Row): { name: string; email: string; role: AdminRole; isActive: boolean } {
  return { name: r.name, email: r.email, role: r.role, isActive: r.is_active };
}

/** Every admin, newest first (D11: unpaged, a team is small). */
export async function listAdminUsers(conn: Db | Tx): Promise<AdminUserRow[]> {
  const { rows } = await conn.execute<Row>(sql`${SELECT} ORDER BY a.created_at DESC, a.id DESC`);
  return rows.map(toRow);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readAdmin(conn: Db | Tx, id: string): Promise<Row> {
  if (!UUID.test(id)) throw new NotFoundError('Admin');
  const { rows } = await conn.execute<Row>(sql`${SELECT} WHERE a.id = ${id}`);
  if (!rows[0]) throw new NotFoundError('Admin');
  return rows[0];
}

function refuseSelf(actor: Actor, id: string): void {
  if (actor.adminId === id) {
    throw new ConflictError("You can't do this to your own account. Ask another super admin.", 'ADMIN_SELF_ACTION');
  }
}

/**
 * Under the lock, after the change: the actor must still be a signed-in super admin (a request authenticated just
 * before another super admin demoted or deactivated them doesn't act), and at least one usable super admin must remain.
 */
async function checkGuards(tx: Tx, actor: Actor): Promise<void> {
  const { rows } = await tx.execute<{ remaining: number; actor_ok: boolean }>(sql`
    SELECT
      (SELECT count(*)::int FROM admin_users
        WHERE role = 'super_admin' AND is_active AND password_hash IS NOT NULL) AS remaining,
      EXISTS (SELECT 1 FROM admin_users
        WHERE id = ${actor.adminId} AND role = 'super_admin' AND is_active AND password_hash IS NOT NULL
          AND token_version = ${actor.tv}) AS actor_ok`);
  if (rows[0]!.remaining === 0) {
    throw new ConflictError('At least one active super admin must remain.', 'ADMIN_LAST_SUPER_ADMIN');
  }
  if (!rows[0]!.actor_ok) throw new AdminSessionEndedError();
}

/** Invites an admin: the row reads `invited` until the link is used; the link is in this answer only. */
export async function inviteAdmin(
  app: TxApp,
  actor: Actor,
  input: { name: string; email: string; role: AdminRole },
): Promise<AdminUserCreateResult> {
  const email = input.email.trim().toLowerCase();
  try {
    return await runTx(app, async (tx) => {
      await lockAdminUsers(tx);
      const taken = await tx.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email));
      if (taken.length > 0) throw emailTaken();
      const [created] = await tx
        .insert(adminUsers)
        .values({ name: input.name.trim(), email, role: input.role, passwordHash: null, createdByAdminId: actor.adminId })
        .returning({ id: adminUsers.id });
      const link = await createPasswordLink(tx, created!.id, 'invite', actor.adminId);
      await checkGuards(tx, actor);
      const row = await readAdmin(tx, created!.id);
      await writeAudit(tx, {
        adminId: actor.adminId,
        action: 'admin_user.create',
        entityType: 'admin_user',
        entityId: row.id,
        before: null,
        after: snapshot(row),
      });
      return { admin: toRow(row), link };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw emailTaken();
    throw err;
  }
}

function emailTaken(): ConflictError {
  return new ConflictError('An admin with this email already exists.', 'ADMIN_EMAIL_TAKEN');
}

/** Changes name and / or role; a role change ends the admin's sessions. Your own role is refused. */
export async function updateAdmin(
  app: TxApp,
  actor: Actor,
  id: string,
  input: { name?: string; role?: AdminRole },
): Promise<AdminUserRow> {
  return runTx(app, async (tx) => {
    await lockAdminUsers(tx);
    const before = await readAdmin(tx, id);
    const roleChanges = input.role !== undefined && input.role !== before.role;
    if (roleChanges) refuseSelf(actor, id);
    await tx
      .update(adminUsers)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(roleChanges ? { role: input.role } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(adminUsers.id, id));
    if (roleChanges) await endAdminSessions(tx, id);
    await checkGuards(tx, actor);
    const after = await readAdmin(tx, id);
    await writeAudit(tx, {
      adminId: actor.adminId,
      action: 'admin_user.update',
      entityType: 'admin_user',
      entityId: id,
      before: snapshot(before),
      after: snapshot(after),
    });
    return toRow(after);
  });
}

/** Deactivates an admin: their sessions end and their open links stop working. Already deactivated: no change. */
export async function deactivateAdmin(app: TxApp, actor: Actor, id: string, input: { reason: string }): Promise<AdminUserRow> {
  const reason = adminText(input.reason);
  return runTx(app, async (tx) => {
    await lockAdminUsers(tx);
    refuseSelf(actor, id);
    const before = await readAdmin(tx, id);
    if (!before.is_active) return toRow(before);
    await tx
      .update(adminUsers)
      .set({ isActive: false, deactivatedAt: sql`now()`, deactivatedByAdminId: actor.adminId, updatedAt: sql`now()` })
      .where(eq(adminUsers.id, id));
    await tx.execute(sql`UPDATE admin_password_tokens SET used_at = now() WHERE admin_id = ${id} AND used_at IS NULL`);
    await endAdminSessions(tx, id);
    await checkGuards(tx, actor);
    const after = await readAdmin(tx, id);
    await writeAudit(tx, {
      adminId: actor.adminId,
      action: 'admin_user.deactivate',
      entityType: 'admin_user',
      entityId: id,
      before: snapshot(before),
      after: { ...snapshot(after), reason },
    });
    return toRow(after);
  });
}

/** Reactivates a deactivated admin (they sign in again; an invited one needs a new link). Already active: no change. */
export async function reactivateAdmin(app: TxApp, actor: Actor, id: string, input: { reason: string }): Promise<AdminUserRow> {
  const reason = adminText(input.reason);
  return runTx(app, async (tx) => {
    await lockAdminUsers(tx);
    const before = await readAdmin(tx, id);
    if (before.is_active) return toRow(before);
    await tx
      .update(adminUsers)
      .set({ isActive: true, deactivatedAt: null, deactivatedByAdminId: null, updatedAt: sql`now()` })
      .where(eq(adminUsers.id, id));
    await checkGuards(tx, actor);
    const after = await readAdmin(tx, id);
    await writeAudit(tx, {
      adminId: actor.adminId,
      action: 'admin_user.reactivate',
      entityType: 'admin_user',
      entityId: id,
      before: snapshot(before),
      after: { ...snapshot(after), reason },
    });
    return toRow(after);
  });
}

/**
 * Issues a set-password link (D11): `invite` while the admin is `invited` (resend), else `reset`, which clears the
 * password. Either way the admin's sessions end. A deactivated admin is `409 ADMIN_DEACTIVATED`; yourself is refused
 * (use change password).
 */
export async function issuePasswordLink(app: TxApp, actor: Actor, id: string): Promise<AdminPasswordLink> {
  return runTx(app, async (tx) => {
    await lockAdminUsers(tx);
    refuseSelf(actor, id);
    const before = await readAdmin(tx, id);
    if (!before.is_active) {
      throw new ConflictError('This admin is deactivated. Reactivate them first.', 'ADMIN_DEACTIVATED');
    }
    const purpose = toRow(before).status === 'invited' ? 'invite' : 'reset';
    if (purpose === 'reset') {
      await tx.update(adminUsers).set({ passwordHash: null, updatedAt: sql`now()` }).where(eq(adminUsers.id, id));
    }
    await endAdminSessions(tx, id);
    const link = await createPasswordLink(tx, id, purpose, actor.adminId);
    await checkGuards(tx, actor);
    await writeAudit(tx, {
      adminId: actor.adminId,
      action: 'admin_user.password_link',
      entityType: 'admin_user',
      entityId: id,
      before: snapshot(before),
      after: { purpose, expiresAt: link.expiresAt },
    });
    return link;
  });
}

/** Ends every session of another admin (yourself: sign out everywhere). */
export async function signOutAdmin(app: TxApp, actor: Actor, id: string): Promise<AdminUserRow> {
  return runTx(app, async (tx) => {
    await lockAdminUsers(tx);
    refuseSelf(actor, id);
    const row = await readAdmin(tx, id);
    await endAdminSessions(tx, id);
    await checkGuards(tx, actor);
    await writeAudit(tx, {
      adminId: actor.adminId,
      action: 'admin_user.sign_out',
      entityType: 'admin_user',
      entityId: id,
      before: null,
      after: null,
    });
    return toRow(row);
  });
}
