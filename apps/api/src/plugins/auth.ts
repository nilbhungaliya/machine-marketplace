import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminRole } from '@mpm/shared-types';
import type { Db } from '../db/index.js';
import { adminUsers, users } from '../db/schema.js';
import { AppError, ForbiddenError, UnauthorizedError } from '../lib/errors.js';

/**
 * An admin session (admin close-out R13, §11.1). `tv` is the admin row's `token_version` when the token was signed;
 * the role in a token is never trusted: `requireAdmin` / `requireAdminRole` replace it with the row's.
 */
export interface AdminTokenPayload {
  adminId: string;
  role: AdminRole;
  tv: number;
}

export interface UserTokenPayload {
  userId: string;
  businessId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminTokenPayload;
    user?: UserTokenPayload;
  }
  interface FastifyInstance {
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdminRole: (...roles: AdminRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Public routes: sets `request.user` for a valid token of an active user, else leaves it unset (never throws). */
    optionalUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedError();
  return header.slice(7);
}

function secret(name: 'ADMIN_JWT_SECRET' | 'JWT_SECRET'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Every token carries `typ` ('admin' | 'user') and verification checks it, so a user token can never pass as an admin
 * token (or the reverse) even if the two secrets were ever set to the same value.
 */
export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign({ ...payload, typ: 'admin' }, secret('ADMIN_JWT_SECRET'), { expiresIn: '12h' });
}

export function signUserToken(payload: UserTokenPayload): string {
  return jwt.sign({ ...payload, typ: 'user' }, secret('JWT_SECRET'), { expiresIn: '30d' });
}

/**
 * Verifies an admin token (signature, expiry and `typ`). Throws on anything else. A token signed before token versions
 * existed has no `tv` and reads as `-1`, which no row has, so every such session ends (plan D2). The token's role is
 * not returned: only `loadActiveAdmin` (the row) says what the admin may do (R13).
 */
export function verifyAdminToken(token: string): { adminId: string; tv: number } {
  const p = jwt.verify(token, secret('ADMIN_JWT_SECRET')) as Partial<AdminTokenPayload> & { typ?: string };
  if (p.typ !== 'admin' || typeof p.adminId !== 'string') throw new Error('Not an admin token');
  return { adminId: p.adminId, tv: Number.isInteger(p.tv) ? (p.tv as number) : -1 };
}

/** Verifies a user token (signature, expiry and `typ`). Throws on anything else. */
export function verifyUserToken(token: string): UserTokenPayload {
  const p = jwt.verify(token, secret('JWT_SECRET')) as UserTokenPayload & { typ?: string };
  if (p.typ !== 'user') throw new Error('Not a user token');
  return { userId: p.userId, businessId: p.businessId };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The signed-in user as the database says right now (F1 + A2 spec §8.2; ruling R5): one primary-key lookup per request
 * and per socket handshake. A user that no longer exists is `401`; a suspended or blocked one is
 * `403 ACCOUNT_SUSPENDED`, so a suspension takes effect on the very next request. The business id comes from the row,
 * not the token, so a business created after sign-in resolves on the old token.
 */
export async function loadActiveUser(db: Db, userId: string): Promise<UserTokenPayload> {
  if (!UUID.test(userId)) throw new UnauthorizedError();
  const [row] = await db
    .select({ status: users.status, businessId: users.businessId })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw new UnauthorizedError();
  if (row.status !== 'active') throw new ForbiddenError('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
  return { userId, businessId: row.businessId };
}

/** `401 ADMIN_SESSION_ENDED`: the admin must sign in again (R13). */
export class AdminSessionEndedError extends AppError {
  constructor() {
    super('Your admin session has ended. Sign in again.', 401, 'ADMIN_SESSION_ENDED');
  }
}

/**
 * The signed-in admin as the database says right now (admin close-out R13, §11.1, plan D2): one primary-key lookup per
 * request and per `/admin` socket handshake. A non-UUID id, a missing row, a deactivated admin, an admin with no
 * password (invited, or a reset link out) or a token version other than `tv` is `401 ADMIN_SESSION_ENDED`. The role
 * comes from the row, so a role change applies on the next request.
 */
export async function loadActiveAdmin(db: Db, adminId: string, tv: number): Promise<AdminTokenPayload> {
  if (!UUID.test(adminId)) throw new AdminSessionEndedError();
  const [row] = await db
    .select({
      role: adminUsers.role,
      isActive: adminUsers.isActive,
      passwordHash: adminUsers.passwordHash,
      tokenVersion: adminUsers.tokenVersion,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, adminId));
  if (!row || !row.isActive || row.passwordHash === null || row.tokenVersion !== tv) throw new AdminSessionEndedError();
  return { adminId, role: row.role, tv: row.tokenVersion };
}

export default fp(async (fastify) => {
  // A bad signature, expiry or `typ` stays `401 UNAUTHORIZED`; a valid token whose session ended is
  // `401 ADMIN_SESSION_ENDED`. Needs the db plugin (registered later in buildApp, so read at request time).
  const verifyAdmin = async (request: FastifyRequest) => {
    let claims: { adminId: string; tv: number };
    try {
      claims = verifyAdminToken(bearer(request));
    } catch {
      throw new UnauthorizedError();
    }
    request.admin = await loadActiveAdmin(fastify.db, claims.adminId, claims.tv);
  };

  fastify.decorate('requireAdmin', async (request: FastifyRequest) => {
    await verifyAdmin(request);
  });

  // super_admin passes every role check. The role is the row's (R13).
  fastify.decorate('requireAdminRole', (...roles: AdminRole[]) => async (request: FastifyRequest) => {
    await verifyAdmin(request);
    const role = request.admin!.role;
    if (role !== 'super_admin' && !roles.includes(role)) throw new ForbiddenError();
  });

  // Needs the db plugin (registered later in buildApp, so read at request time); every user route has it.
  fastify.decorate('requireUser', async (request: FastifyRequest) => {
    let payload: UserTokenPayload;
    try {
      payload = verifyUserToken(bearer(request));
    } catch {
      throw new UnauthorizedError();
    }
    request.user = await loadActiveUser(fastify.db, payload.userId);
  });

  // F2 spec §14, R55: a public page never fails because of a stale session. No header, a malformed, expired or
  // wrongly-signed token, an admin token, an unknown user and a suspended or blocked one are all a guest. Only the
  // auth outcomes are swallowed: a database failure still surfaces as a 500.
  fastify.decorate('optionalUser', async (request: FastifyRequest) => {
    request.user = undefined;
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    let payload: UserTokenPayload;
    try {
      payload = verifyUserToken(header.slice(7));
    } catch {
      return;
    }
    try {
      request.user = await loadActiveUser(fastify.db, payload.userId);
    } catch (err) {
      if (err instanceof AppError) return;
      throw err;
    }
  });
});
