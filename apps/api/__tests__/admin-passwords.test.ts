import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import type { AdminRole } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { adminPasswordTokens, adminUsers } from '../src/db/schema.js';
import { loginEmailKey } from '../src/services/admin-users/lockout.js';
import { hashLinkToken } from '../src/services/admin-users/password-links.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';

// Admin close-out A2-2 (§11.2, R15, plan D11, D14): links work once, for 48 h, newest wins, and only while the admin is
// active; the raw token is stored and audited nowhere; passwords are 12–128 characters and not the email; a password
// change hands back a fresh token while every other session ends; 5 failed logins for one email lock it for 15 min.
// The login and link routes allow 10 calls a minute per IP, so each case calls them from its own address.

let app: FastifyInstance;
const adminIds: string[] = [];
const PASSWORD = 'a long enough password';
let ipSeq = 1;
const newIp = () => `10.20.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

async function admin(role: AdminRole, opts?: Parameters<typeof createTestAdmin>[1]) {
  const a = await createTestAdmin(role, opts);
  adminIds.push(a.id);
  return a;
}

const authed = (method: 'GET' | 'POST', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(method === 'GET' ? {} : { payload: payload ?? {} }) });
const me = (token: string) => authed('GET', '/admin/auth/me', token);
const publicPost = (url: string, payload: Record<string, string>, ip: string) => app.inject({ method: 'POST', url, payload, remoteAddress: ip });
const inspect = (token: string, ip: string) => publicPost('/admin/auth/password/inspect', { token }, ip);
const setPassword = (token: string, password: string, ip: string) =>
  publicPost('/admin/auth/password/set', { token, password }, ip);
const login = (email: string, password: string, ip: string) => publicPost('/admin/auth/login', { email, password }, ip);

/** A super admin invites a new admin: its id, email and link token. */
async function invited(s: { token: string }) {
  const email = `pw-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await authed('POST', '/admin/admin-users', s.token, { name: 'Link Admin', email, role: 'support' });
  expect(res.statusCode).toBe(200);
  const { admin: row, link } = res.json().data;
  adminIds.push(row.id);
  return { id: row.id as string, email, token: link.token as string };
}

let s: { id: string; token: string };

beforeAll(async () => {
  app = await buildApp({ logger: false });
  s = await admin('super_admin');
});

afterAll(async () => {
  await deleteTestAdmins(adminIds);
  await app.close();
});

describe('password links (R15)', () => {
  it('sets the password once; a second use is invalid; the admin then signs in', async () => {
    const ip = newIp();
    const x = await invited(s);
    const info = await inspect(x.token, ip);
    expect(info.statusCode).toBe(200);
    expect(info.json().data).toEqual({ name: 'Link Admin', email: x.email, purpose: 'invite' });

    const set = await setPassword(x.token, PASSWORD, ip);
    expect(set.statusCode).toBe(200);
    expect(set.json().data).toEqual({ email: x.email });
    const again = await setPassword(x.token, PASSWORD, ip);
    expect(again.statusCode).toBe(400);
    expect(again.json().code).toBe('PASSWORD_LINK_INVALID');
    expect((await login(x.email, PASSWORD, newIp())).statusCode).toBe(200);
  });

  it('ends the old session on a reset and lets the new password sign in', async () => {
    const y = await admin('moderator', { password: 'the old password here' });
    const link = await authed('POST', `/admin/admin-users/${y.id}/password-link`, s.token);
    expect(link.statusCode).toBe(200);
    const ip = newIp();
    expect((await inspect(link.json().data.token, ip)).json().data.purpose).toBe('reset');
    expect((await setPassword(link.json().data.token, PASSWORD, ip)).statusCode).toBe(200);
    expect((await me(y.token)).json().code).toBe('ADMIN_SESSION_ENDED');
    const res = await login(y.email, PASSWORD, newIp());
    expect(res.statusCode).toBe(200);
    expect((await me(res.json().data.token)).statusCode).toBe(200);
  });

  it('refuses an expired link and one replaced by a newer link', async () => {
    const ip = newIp();
    const x = await invited(s);
    await db
      .update(adminPasswordTokens)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(adminPasswordTokens.tokenHash, hashLinkToken(x.token)));
    expect((await inspect(x.token, ip)).json().code).toBe('PASSWORD_LINK_INVALID');
    expect((await setPassword(x.token, PASSWORD, ip)).json().code).toBe('PASSWORD_LINK_INVALID');

    const z = await invited(s);
    const newer = await authed('POST', `/admin/admin-users/${z.id}/password-link`, s.token);
    expect(newer.json().data.token).not.toBe(z.token);
    expect((await inspect(z.token, ip)).json().code).toBe('PASSWORD_LINK_INVALID');
    expect((await inspect(newer.json().data.token, ip)).statusCode).toBe(200);
  });

  it('refuses inspect and set on the link of an admin deactivated after it was issued (D11)', async () => {
    const ip = newIp();
    const x = await invited(s);
    const off = await authed('POST', `/admin/admin-users/${x.id}/deactivate`, s.token, { reason: 'Hired by mistake' });
    expect(off.statusCode).toBe(200);
    const res = await inspect(x.token, ip);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('PASSWORD_LINK_INVALID');
    expect((await setPassword(x.token, PASSWORD, ip)).json().code).toBe('PASSWORD_LINK_INVALID');
    // Even with its token row untouched (only the admin's state decides).
    await db.update(adminPasswordTokens).set({ usedAt: null }).where(eq(adminPasswordTokens.tokenHash, hashLinkToken(x.token)));
    expect((await inspect(x.token, ip)).json().code).toBe('PASSWORD_LINK_INVALID');
  });

  it('stores and audits the raw token nowhere', async () => {
    const ip = newIp();
    const x = await invited(s);
    expect((await setPassword(x.token, PASSWORD, ip)).statusCode).toBe(200);
    const like = `%${x.token}%`;
    const { rows: stored } = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM admin_password_tokens t WHERE t::text LIKE ${like}`,
    );
    const { rows: audited } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log a WHERE a::text LIKE ${like}`);
    expect(stored[0]!.n).toBe(0);
    expect(audited[0]!.n).toBe(0);
    const [row] = await db.select().from(adminPasswordTokens).where(eq(adminPasswordTokens.tokenHash, hashLinkToken(x.token)));
    expect(row!.usedAt).not.toBeNull();
  });

  it('refuses a short password and the email as the password', async () => {
    const ip = newIp();
    const x = await invited(s);
    const short = await setPassword(x.token, 'short', ip);
    expect(short.statusCode).toBe(400);
    expect(short.json().code).toBe('PASSWORD_TOO_WEAK');
    const email = await setPassword(x.token, x.email.toUpperCase(), ip);
    expect(email.statusCode).toBe(400);
    expect(email.json().code).toBe('PASSWORD_TOO_WEAK');
    // The link still works after a refused password.
    expect((await inspect(x.token, ip)).statusCode).toBe(200);
  });
});

describe('change password and sign out everywhere (§11.2)', () => {
  it('refuses a wrong current password; the right one returns a fresh token and ends the old one', async () => {
    const a = await admin('operations', { password: 'my current password' });
    const wrong = await authed('POST', '/admin/auth/password/change', a.token, { current: 'not my password', password: PASSWORD });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe('PASSWORD_WRONG');

    const res = await authed('POST', '/admin/auth/password/change', a.token, { current: 'my current password', password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const fresh = res.json().data.token as string;
    expect(res.json().data.user).toMatchObject({ id: a.id, role: 'operations' });
    expect((await me(fresh)).statusCode).toBe(200);
    expect((await me(a.token)).json().code).toBe('ADMIN_SESSION_ENDED');
    expect((await login(a.email, PASSWORD, newIp())).statusCode).toBe(200);
  });

  it('ends the caller’s own token on sign out everywhere', async () => {
    const a = await admin('support');
    const res = await authed('POST', '/admin/auth/sign-out-everywhere', a.token);
    expect(res.statusCode).toBe(200);
    expect((await me(a.token)).json().code).toBe('ADMIN_SESSION_ENDED');
  });
});

describe('login lockout (R15, D14 as amended)', () => {
  it('locks an email + IP after 5 failures, even for the right password; another IP gets in; a reset clears it', async () => {
    const a = await admin('support', { password: PASSWORD });
    const ip = newIp();
    for (let i = 0; i < 5; i++) expect((await login(a.email, 'wrong password', ip)).statusCode).toBe(401);
    const res = await login(a.email.toUpperCase(), PASSWORD, ip);
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('TOO_MANY_ATTEMPTS');
    expect(new Date(res.json().details.retryAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect((await login(a.email, PASSWORD, newIp())).statusCode).toBe(200);
    expect((await login(a.email, PASSWORD, ip)).statusCode).toBe(429);

    const link = await authed('POST', `/admin/admin-users/${a.id}/password-link`, s.token);
    expect((await setPassword(link.json().data.token, 'a brand new password', newIp())).statusCode).toBe(200);
    expect((await login(a.email, 'a brand new password', ip)).statusCode).toBe(200);
  });

  it('locks an unknown email the same way', async () => {
    const email = `nobody-${Date.now()}@example.test`;
    const ip = newIp();
    for (let i = 0; i < 5; i++) expect((await login(email, 'any password', ip)).statusCode).toBe(401);
    expect((await login(email, 'any password', ip)).json().code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('resets the count on a successful login', async () => {
    const a = await admin('support', { password: PASSWORD });
    const ip = newIp();
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 4; i++) expect((await login(a.email, 'wrong password', ip)).statusCode).toBe(401);
      expect((await login(a.email, PASSWORD, ip)).statusCode).toBe(200);
    }
    const [row] = await db.select({ at: adminUsers.lastLoginAt }).from(adminUsers).where(eq(adminUsers.id, a.id));
    expect(row!.at).not.toBeNull();
  });

  it('refuses the email from any IP over 50 failures in an hour', async () => {
    const a = await admin('support', { password: PASSWORD });
    await app.redis!.set(loginEmailKey(a.email), '50', 'EX', 3600);
    const res = await login(a.email, PASSWORD, newIp());
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('TOO_MANY_ATTEMPTS');
  });
});
