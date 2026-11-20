import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AdminRole } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { adminUsers, auditLog } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';

// Admin close-out A2-1 (§11.2, R14, plan D11, D12, D15): super admins manage the team; never on themselves, never
// leaving zero usable super admins (serialised by the advisory lock, so a race leaves one); every change of role,
// deactivation, reset or sign-out ends the admin's sessions; every action writes its `admin_user.*` row with no hash
// or link in it.

let app: FastifyInstance;
const adminIds: string[] = [];
const tokens: string[] = [];

async function admin(role: AdminRole, opts?: Parameters<typeof createTestAdmin>[1]) {
  const a = await createTestAdmin(role, opts);
  adminIds.push(a.id);
  return a;
}

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(method === 'GET' ? {} : { payload: payload ?? {} }) });
const me = (token: string) => call('GET', '/admin/auth/me', token);
const reason = { reason: 'Left the company' };

async function invite(actorToken: string, role: AdminRole, email = `invite-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`) {
  const res = await call('POST', '/admin/admin-users', actorToken, { name: 'New Admin', email, role });
  if (res.statusCode === 200) {
    adminIds.push(res.json().data.admin.id);
    tokens.push(res.json().data.link.token);
  }
  return res;
}

/** Usable super admins in the whole test database (active, with a password). */
async function usableSuperAdmins(): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM admin_users WHERE role = 'super_admin' AND is_active AND password_hash IS NOT NULL`,
  );
  return rows[0]!.n;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
});

afterAll(async () => {
  await deleteTestAdmins(adminIds);
  await app.close();
});

describe('invite (§11.2)', () => {
  it('returns the link once and lists the admin as invited', async () => {
    const s = await admin('super_admin');
    const res = await invite(s.token, 'moderator');
    expect(res.statusCode).toBe(200);
    const { admin: row, link } = res.json().data;
    expect(row).toMatchObject({ role: 'moderator', status: 'invited', createdBy: { id: s.id } });
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000);

    const list = await call('GET', '/admin/admin-users', s.token);
    expect(list.statusCode).toBe(200);
    expect(list.json().data.find((r: { id: string }) => r.id === row.id)).toMatchObject({ status: 'invited' });
    expect(list.body).not.toContain(link.token);
  });

  it('refuses an email already taken, in any case', async () => {
    const s = await admin('super_admin');
    const email = `taken-${Date.now()}@example.test`;
    expect((await invite(s.token, 'support', email)).statusCode).toBe(200);
    const again = await invite(s.token, 'support', email.toUpperCase());
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ADMIN_EMAIL_TAKEN');
  });
});

describe('nobody acts on themselves (R14)', () => {
  it('refuses your own role change, deactivation, reset and sign-out', async () => {
    const s = await admin('super_admin');
    const attempts = [
      call('PATCH', `/admin/admin-users/${s.id}`, s.token, { role: 'support' }),
      call('POST', `/admin/admin-users/${s.id}/deactivate`, s.token, reason),
      call('POST', `/admin/admin-users/${s.id}/password-link`, s.token),
      call('POST', `/admin/admin-users/${s.id}/sign-out`, s.token),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ADMIN_SELF_ACTION');
    }
    expect((await me(s.token)).statusCode).toBe(200);
  });
});

describe('sessions end (R13)', () => {
  it('ends the old token on deactivation, role change, reset and sign-out', async () => {
    const s = await admin('super_admin');
    const deactivated = await admin('moderator');
    const demoted = await admin('moderator');
    const reset = await admin('moderator');
    const signedOut = await admin('moderator');
    for (const a of [deactivated, demoted, reset, signedOut]) expect((await me(a.token)).statusCode).toBe(200);

    expect((await call('POST', `/admin/admin-users/${deactivated.id}/deactivate`, s.token, reason)).statusCode).toBe(200);
    const patched = await call('PATCH', `/admin/admin-users/${demoted.id}`, s.token, { role: 'support' });
    expect(patched.json().data.role).toBe('support');
    const link = await call('POST', `/admin/admin-users/${reset.id}/password-link`, s.token);
    expect(link.statusCode).toBe(200);
    tokens.push(link.json().data.token);
    expect((await call('POST', `/admin/admin-users/${signedOut.id}/sign-out`, s.token)).statusCode).toBe(200);

    for (const a of [deactivated, demoted, reset, signedOut]) {
      const res = await me(a.token);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('ADMIN_SESSION_ENDED');
    }
    const versions = await db
      .select({ id: adminUsers.id, tv: adminUsers.tokenVersion })
      .from(adminUsers)
      .where(inArray(adminUsers.id, [deactivated.id, demoted.id, reset.id, signedOut.id]));
    expect(versions.every((v) => v.tv === 1)).toBe(true);
  });

  it('reads reset_pending after a reset of an admin who signed in before, and refuses a link for a deactivated one', async () => {
    const s = await admin('super_admin');
    const a = await admin('operations');
    await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, a.id));
    const link = await call('POST', `/admin/admin-users/${a.id}/password-link`, s.token);
    tokens.push(link.json().data.token);
    const list = await call('GET', '/admin/admin-users', s.token);
    expect(list.json().data.find((r: { id: string }) => r.id === a.id).status).toBe('reset_pending');

    const gone = await admin('support');
    expect((await call('POST', `/admin/admin-users/${gone.id}/deactivate`, s.token, reason)).statusCode).toBe(200);
    const refused = await call('POST', `/admin/admin-users/${gone.id}/password-link`, s.token);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('ADMIN_DEACTIVATED');
  });
});

describe('audit rows (D15)', () => {
  it('writes an admin_user.* row for every action, with no password, hash or link in it', async () => {
    const s = await admin('super_admin');
    const created = await invite(s.token, 'support');
    const id = created.json().data.admin.id as string;
    await call('PATCH', `/admin/admin-users/${id}`, s.token, { name: 'Renamed Admin', role: 'moderator' });
    const link = await call('POST', `/admin/admin-users/${id}/password-link`, s.token);
    tokens.push(link.json().data.token);
    await call('POST', `/admin/admin-users/${id}/sign-out`, s.token);
    await call('POST', `/admin/admin-users/${id}/deactivate`, s.token, reason);
    await call('POST', `/admin/admin-users/${id}/reactivate`, s.token, { reason: 'Came back' });

    const rows = await db
      .select({ action: auditLog.action, before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'admin_user'), eq(auditLog.entityId, id)));
    expect(rows.map((r) => r.action).sort()).toEqual([
      'admin_user.create',
      'admin_user.deactivate',
      'admin_user.password_link',
      'admin_user.reactivate',
      'admin_user.sign_out',
      'admin_user.update',
    ]);
    expect(rows.find((r) => r.action === 'admin_user.update')!.after).toMatchObject({ name: 'Renamed Admin', role: 'moderator' });

    const leaks = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          inArray(auditLog.adminId, adminIds),
          sql`(coalesce(${auditLog.before}::text, '') || coalesce(${auditLog.after}::text, '')) ~* 'password|hash'`,
        ),
      );
    expect(leaks).toEqual([]);
    for (const token of tokens) {
      const { rows: hit } = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM audit_log WHERE (coalesce(before::text, '') || coalesce(after::text, '')) LIKE ${`%${token}%`}`,
      );
      expect(hit[0]!.n).toBe(0);
    }
  });
});

describe('roles (§11.2)', () => {
  it('gives support 403 on every admin-user route', async () => {
    const support = await admin('support');
    const id = randomUUID();
    const routes: Array<['GET' | 'POST' | 'PATCH', string, unknown?]> = [
      ['GET', '/admin/admin-users'],
      ['POST', '/admin/admin-users', { name: 'X Admin', email: 'x@example.test', role: 'support' }],
      ['PATCH', `/admin/admin-users/${id}`, { name: 'X Admin' }],
      ['POST', `/admin/admin-users/${id}/deactivate`, reason],
      ['POST', `/admin/admin-users/${id}/reactivate`, reason],
      ['POST', `/admin/admin-users/${id}/password-link`],
      ['POST', `/admin/admin-users/${id}/sign-out`],
    ];
    for (const [method, url, payload] of routes) {
      expect((await call(method, url, support.token, payload)).statusCode, `${method} ${url}`).toBe(403);
    }
  });
});

// Last: each case retires this suite's earlier super admins, so the two it creates are the only usable ones.
describe('the last super admin (R14, D12)', () => {
  async function twoSuperAdmins() {
    await db
      .update(adminUsers)
      .set({ isActive: false })
      .where(and(inArray(adminUsers.id, adminIds), eq(adminUsers.role, 'super_admin')));
    // The test database holds no other usable super admin (suites delete theirs).
    expect(await usableSuperAdmins()).toBe(0);
    return [await admin('super_admin'), await admin('super_admin')] as const;
  }

  async function race(actions: [() => ReturnType<typeof call>, () => ReturnType<typeof call>]) {
    const results = await Promise.all(actions.map((f) => f()));
    // The loser is refused by the guard under the lock (409) or, when the winner committed before its request was
    // authenticated, by its ended session (401). Either way exactly one usable super admin remains.
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const loser = results.find((r) => r.statusCode !== 200)!;
    expect([401, 409]).toContain(loser.statusCode);
    expect(loser.json().code).toBe(loser.statusCode === 409 ? 'ADMIN_LAST_SUPER_ADMIN' : 'ADMIN_SESSION_ENDED');
    expect(await usableSuperAdmins()).toBe(1);
    return results;
  }

  it('leaves one when two super admins demote each other at once', async () => {
    const [a, b] = await twoSuperAdmins();
    await race([
      () => call('PATCH', `/admin/admin-users/${b.id}`, a.token, { role: 'support' }),
      () => call('PATCH', `/admin/admin-users/${a.id}`, b.token, { role: 'support' }),
    ]);
  });

  it('leaves one when two super admins deactivate each other at once', async () => {
    const [a, b] = await twoSuperAdmins();
    await race([
      () => call('POST', `/admin/admin-users/${b.id}/deactivate`, a.token, reason),
      () => call('POST', `/admin/admin-users/${a.id}/deactivate`, b.token, reason),
    ]);
  });

  it('leaves one when two super admins reset each other at once (a reset admin cannot sign in)', async () => {
    const [a, b] = await twoSuperAdmins();
    const results = await race([
      () => call('POST', `/admin/admin-users/${b.id}/password-link`, a.token),
      () => call('POST', `/admin/admin-users/${a.id}/password-link`, b.token),
    ]);
    tokens.push(results.find((r) => r.statusCode === 200)!.json().data.token);
  });
});
