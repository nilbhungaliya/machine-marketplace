import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { adminRateLimit } from '../../lib/group-limit.js';
import { loginAdmin } from '../../services/admin-auth.service.js';
import {
  changePassword,
  inspectPasswordLink,
  setPasswordFromLink,
  signOutEverywhere,
} from '../../services/admin-users/password-links.js';

const loginBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(1024),
});

// Lengths here only bound the request; the 12–128 rule is the service's `400 PASSWORD_TOO_WEAK`.
const linkToken = z.string().min(1).max(200);
const newPassword = z.string().min(1).max(1024);
const inspectBody = z.object({ token: linkToken }).strict();
const setBody = z.object({ token: linkToken, password: newPassword }).strict();
const changeBody = z.object({ current: z.string().min(1).max(1024), password: newPassword }).strict();
const emptyBody = z.object({}).strict();

// Thin controller: validate → service → `{ data }`. No business logic here.
const adminAuthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/admin/auth/login',
    { schema: { tags: ['Admin Auth'] }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { email, password } = loginBody.parse(request.body);
      return { data: await loginAdmin(fastify, { email, password, ip: request.ip }) };
    },
  );

  // The session as the admin row says now (admin close-out R13): the row's role and token version, never the token's.
  fastify.get(
    '/admin/auth/me',
    { schema: { tags: ['Admin Auth'] }, preHandler: fastify.requireAdmin },
    async (request) => ({ data: request.admin }),
  );

  // Admin close-out §11.2, R15 (lane A2). Password links: public, 10 / min per IP; the token travels in the body only
  // (never a query string or a log line).
  //   POST /admin/auth/password/inspect { token } → PasswordLinkInfo
  //   POST /admin/auth/password/set { token, password } → { email } (ends the admin's sessions; they sign in next)
  //   POST /admin/auth/password/change { current, password } → { token, user } (a fresh token of the new version)
  //   POST /admin/auth/sign-out-everywhere → { ok } (ends the caller's own sessions, this one included)
  const publicLink = { schema: { tags: ['Admin Auth'] }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  fastify.post('/admin/auth/password/inspect', publicLink, async (request) => {
    const { token } = inspectBody.parse(request.body ?? {});
    return { data: await inspectPasswordLink(fastify.db, token) };
  });
  fastify.post('/admin/auth/password/set', publicLink, async (request) => {
    const body = setBody.parse(request.body ?? {});
    return { data: await setPasswordFromLink(fastify, body) };
  });

  const signedIn = { schema: { tags: ['Admin Auth'] }, preHandler: fastify.requireAdmin };
  // 10 tries per 10 min per admin, wrong current passwords included (the limit counts every call).
  const change = { ...signedIn, preHandler: [fastify.requireAdmin, adminRateLimit('admin_password_change', 10, 600)] };
  fastify.post('/admin/auth/password/change', change, async (request) => {
    const body = changeBody.parse(request.body ?? {});
    return { data: await changePassword(fastify, request.admin!, body) };
  });
  fastify.post('/admin/auth/sign-out-everywhere', signedIn, async (request) => {
    emptyBody.parse(request.body ?? {});
    return { data: await signOutEverywhere(fastify, request.admin!) };
  });
};

export default adminAuthRoutes;
