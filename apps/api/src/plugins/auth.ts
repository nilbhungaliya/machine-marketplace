import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminRole } from '@mpm/shared-types';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';

export interface AdminTokenPayload {
  adminId: string;
  role: AdminRole;
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

/** Verifies an admin token (signature, expiry and `typ`). Throws on anything else. */
export function verifyAdminToken(token: string): AdminTokenPayload {
  const p = jwt.verify(token, secret('ADMIN_JWT_SECRET')) as AdminTokenPayload & { typ?: string };
  if (p.typ !== 'admin') throw new Error('Not an admin token');
  return { adminId: p.adminId, role: p.role };
}

/** Verifies a user token (signature, expiry and `typ`). Throws on anything else. */
export function verifyUserToken(token: string): UserTokenPayload {
  const p = jwt.verify(token, secret('JWT_SECRET')) as UserTokenPayload & { typ?: string };
  if (p.typ !== 'user') throw new Error('Not a user token');
  return { userId: p.userId, businessId: p.businessId };
}

export default fp(async (fastify) => {
  const verifyAdmin = (request: FastifyRequest) => {
    try {
      request.admin = verifyAdminToken(bearer(request));
    } catch {
      throw new UnauthorizedError();
    }
  };

  fastify.decorate('requireAdmin', async (request: FastifyRequest) => {
    verifyAdmin(request);
  });

  // super_admin passes every role check.
  fastify.decorate('requireAdminRole', (...roles: AdminRole[]) => async (request: FastifyRequest) => {
    verifyAdmin(request);
    const role = request.admin!.role;
    if (role !== 'super_admin' && !roles.includes(role)) throw new ForbiddenError();
  });

  fastify.decorate('requireUser', async (request: FastifyRequest) => {
    try {
      request.user = verifyUserToken(bearer(request));
    } catch {
      throw new UnauthorizedError();
    }
  });
});
