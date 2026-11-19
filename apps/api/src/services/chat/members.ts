import { and, eq, inArray } from 'drizzle-orm';
import type { MemberRole, PartySide } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { chatThreads, users } from '../../db/schema.js';
import { AppError, ForbiddenError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';

/**
 * Who reads a thread (F6 + F7 spec §6, R10; ported from textile `thread.service.ts` `readerOf` / `getThreadForMember` /
 * `assertCanWrite`). A thread belongs to two businesses; every active member of either reads it, a `viewer` read-only
 * and always masked.
 */

export type ThreadRow = typeof chatThreads.$inferSelect;

export interface ChatReader {
  userId: string;
  businessId: string;
  memberRole: MemberRole;
  side: PartySide;
}

export function threadNotFound(): AppError {
  return new AppError('Thread not found', 404, 'THREAD_NOT_FOUND');
}

/** The reader's side, or null for a business that isn't a party. */
export function sideOf(thread: Pick<ThreadRow, 'buyerBusinessId' | 'sellerBusinessId'>, businessId: string | null): PartySide | null {
  if (businessId === null) return null;
  if (thread.buyerBusinessId === businessId) return 'buyer';
  if (thread.sellerBusinessId === businessId) return 'seller';
  return null;
}

/**
 * The thread and the caller as a reader. `404 THREAD_NOT_FOUND` for a thread that doesn't exist or isn't the caller's
 * business's (ids don't leak). `lock` takes the thread `FOR UPDATE` (last in the §8.5 order).
 */
export async function getThreadForParty(
  conn: Db | Tx,
  user: UserTokenPayload,
  threadId: string,
  opts: { lock?: boolean } = {},
): Promise<{ thread: ThreadRow; reader: ChatReader }> {
  if (!user.businessId) throw threadNotFound();
  const query = conn.select().from(chatThreads).where(eq(chatThreads.id, threadId));
  const [thread] = opts.lock ? await query.for('update') : await query;
  const side = thread ? sideOf(thread, user.businessId) : null;
  if (!thread || !side) throw threadNotFound();
  const [member] = await conn.select({ memberRole: users.memberRole }).from(users).where(eq(users.id, user.userId));
  if (!member) throw threadNotFound();
  return { thread, reader: { userId: user.userId, businessId: user.businessId, memberRole: member.memberRole, side } };
}

/** `403 VIEWER_READ_ONLY` for a viewer. Archive and read don't call this (P15). */
export function assertCanWrite(reader: Pick<ChatReader, 'memberRole'>): void {
  if (reader.memberRole === 'viewer') throw new ForbiddenError('Viewers can read but not write', 'VIEWER_READ_ONLY');
}

/** Active members of a business (suspended and blocked users skipped). */
export async function businessMembers(
  conn: Db | Tx,
  businessId: string,
): Promise<Array<{ userId: string; businessId: string; memberRole: MemberRole }>> {
  const rows = await conn
    .select({ userId: users.id, memberRole: users.memberRole })
    .from(users)
    .where(and(eq(users.businessId, businessId), eq(users.status, 'active')));
  return rows.map((r) => ({ ...r, businessId }));
}

/** Active members of both businesses of a thread, each as a reader with their side. */
export async function threadMembers(
  conn: Db | Tx,
  thread: Pick<ThreadRow, 'buyerBusinessId' | 'sellerBusinessId'>,
): Promise<ChatReader[]> {
  const rows = await conn
    .select({ userId: users.id, businessId: users.businessId, memberRole: users.memberRole })
    .from(users)
    .where(and(inArray(users.businessId, [thread.buyerBusinessId, thread.sellerBusinessId]), eq(users.status, 'active')));
  return rows.map((r) => ({
    userId: r.userId,
    businessId: r.businessId!,
    memberRole: r.memberRole,
    side: r.businessId === thread.buyerBusinessId ? 'buyer' : 'seller',
  }));
}
