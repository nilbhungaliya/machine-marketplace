import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { users } from '../db/schema.js';
import { ForbiddenError } from './errors.js';

/**
 * Member-role preHandlers for F6 + F7 user routes (spec §12), placed after `requireUser`. The role is read from the
 * database on each request (as the status is), so a role change applies at once.
 * - `refuseViewer`: every business write; a `viewer` gets `403 VIEWER_READ_ONLY`. Reading, marking read, archiving
 *   (P15) and per-user settings (notifications, devices, language) don't use it.
 * - `ownerOnly`: the business contact number (§6.6); others get `403 OWNER_ONLY`.
 */

async function memberRoleOf(request: FastifyRequest) {
  const [row] = await request.server.db.select({ memberRole: users.memberRole }).from(users).where(eq(users.id, request.user!.userId));
  return row?.memberRole;
}

export async function refuseViewer(request: FastifyRequest): Promise<void> {
  if ((await memberRoleOf(request)) === 'viewer') throw new ForbiddenError('Viewers can read but not write', 'VIEWER_READ_ONLY');
}

export async function ownerOnly(request: FastifyRequest): Promise<void> {
  if ((await memberRoleOf(request)) !== 'owner') throw new ForbiddenError("Only your business's owner can do this", 'OWNER_ONLY');
}
