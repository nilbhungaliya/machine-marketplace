import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { ADMIN_ROLES, EXPORT_SHEETS, EXPORT_SHEET_ROLES, type AdminRole } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { adminUsers } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';

// Admin close-out plan C0-4 (review focus 1): every new admin route with its final guard. No token → 401; a role
// outside its list → 403; an allowed role and super_admin → neither; a token of an ended session (stale `tv`) → 401
// ADMIN_SESSION_ENDED. The password-link routes are public; change password and sign out everywhere end the caller's
// own token, so each call there uses a fresh admin.

type Method = 'GET' | 'POST' | 'PATCH';
interface RouteCase {
  method: Method;
  url: string;
  /** Roles besides super_admin; 'any' = every admin. */
  roles: AdminRole[] | 'any';
  /** Ends the caller's sessions once built: use a fresh admin per call. */
  endsOwnSession?: boolean;
}

const id = randomUUID();
const SUPER: AdminRole[] = [];
const STAFF: AdminRole[] = ['moderator', 'support'];

const ROUTES: RouteCase[] = [
  // AD1 dashboard (§6.3)
  { method: 'GET', url: '/admin/dashboard?range=30d', roles: 'any' },
  { method: 'GET', url: '/admin/dashboard/work', roles: 'any' },
  { method: 'GET', url: '/admin/dashboard/options', roles: 'any' },
  // AD7 admin users (§11.2)
  { method: 'GET', url: '/admin/admin-users', roles: SUPER },
  { method: 'POST', url: '/admin/admin-users', roles: SUPER },
  { method: 'PATCH', url: `/admin/admin-users/${id}`, roles: SUPER },
  { method: 'POST', url: `/admin/admin-users/${id}/deactivate`, roles: SUPER },
  { method: 'POST', url: `/admin/admin-users/${id}/reactivate`, roles: SUPER },
  { method: 'POST', url: `/admin/admin-users/${id}/password-link`, roles: SUPER },
  { method: 'POST', url: `/admin/admin-users/${id}/sign-out`, roles: SUPER },
  { method: 'POST', url: '/admin/auth/password/change', roles: 'any', endsOwnSession: true },
  { method: 'POST', url: '/admin/auth/sign-out-everywhere', roles: 'any', endsOwnSession: true },
  // AD7 audit log (§11.2)
  { method: 'GET', url: '/admin/audit-log', roles: SUPER },
  { method: 'GET', url: '/admin/audit-log/facets', roles: SUPER },
  { method: 'GET', url: '/admin/audit-log/export', roles: SUPER },
  { method: 'GET', url: `/admin/audit-log/${id}`, roles: SUPER },
  { method: 'POST', url: `/admin/audit-log/${id}/reveal`, roles: SUPER },
  // AD6 fraud signals (§8.3) and the Reports & flags count (D5)
  { method: 'GET', url: '/admin/fraud-signals', roles: STAFF },
  { method: 'GET', url: `/admin/fraud-signals/${id}`, roles: STAFF },
  { method: 'POST', url: `/admin/fraud-signals/${id}/review`, roles: STAFF },
  { method: 'GET', url: '/admin/reports/count', roles: STAFF },
  // AD6 exports (§10, R12): you can export what you can list
  ...EXPORT_SHEETS.map((sheet): RouteCase => ({ method: 'GET', url: `/admin/exports/${sheet}`, roles: EXPORT_SHEET_ROLES[sheet] })),
];

let app: FastifyInstance;
const adminIds: string[] = [];
const byRole = new Map<AdminRole, string>();
let stale: string;
let user: TestBusinessUser;

async function adminToken(role: AdminRole): Promise<string> {
  const a = await createTestAdmin(role);
  adminIds.push(a.id);
  return a.token;
}

const call = (r: RouteCase, token?: string) =>
  app.inject({
    method: r.method,
    url: r.url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(r.method === 'GET' ? {} : { payload: {} }),
  });

const label = (r: RouteCase) => `${r.method} ${r.url}`;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  for (const role of ADMIN_ROLES) byRole.set(role, await adminToken(role));
  const s = await createTestAdmin('super_admin');
  adminIds.push(s.id);
  await db.update(adminUsers).set({ tokenVersion: sql`${adminUsers.tokenVersion} + 1` }).where(eq(adminUsers.id, s.id));
  stale = s.token;
  user = await createTestBusinessUser();
});

afterAll(async () => {
  if (user) await deleteTestBusinesses([user.businessId]);
  await deleteTestAdmins(adminIds);
  await app.close();
});

describe('new admin routes (R13, §6.3, §8.3, §10, §11.2)', () => {
  it('refuse a request without a token', async () => {
    for (const r of ROUTES) expect((await call(r)).statusCode, label(r)).toBe(401);
  });

  it('end a session whose token version is stale', async () => {
    for (const r of ROUTES) {
      const res = await call(r, stale);
      expect(res.statusCode, label(r)).toBe(401);
      expect(res.json().code, label(r)).toBe('ADMIN_SESSION_ENDED');
    }
  });

  it('refuse roles outside the list and let the listed roles and super_admin through', async () => {
    for (const r of ROUTES) {
      for (const role of ADMIN_ROLES) {
        const allowed = role === 'super_admin' || r.roles === 'any' || r.roles.includes(role);
        const token = r.endsOwnSession ? await adminToken(role) : byRole.get(role)!;
        const status = (await call(r, token)).statusCode;
        if (allowed) expect([401, 403], `${label(r)} as ${role}`).not.toContain(status);
        else expect(status, `${label(r)} as ${role}`).toBe(403);
      }
    }
  });

  it('answer an unknown export sheet with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/exports/everything',
      headers: { authorization: `Bearer ${byRole.get('super_admin')}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('keep the password-link routes public', async () => {
    for (const url of ['/admin/auth/password/inspect', '/admin/auth/password/set']) {
      const status = (await app.inject({ method: 'POST', url, payload: { token: 'x'.repeat(43) } })).statusCode;
      expect(status, url).not.toBe(401);
    }
  });
});

describe('report a business (§7.1)', () => {
  it('needs a user token', async () => {
    const url = `/businesses/${randomUUID()}/reports`;
    expect((await app.inject({ method: 'POST', url, payload: { reason: 'abusive' } })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${user.token}` }, payload: { reason: 'abusive' } });
    expect([401, 403]).not.toContain(res.statusCode);
  });
});
