import { and, eq, inArray } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import type { AccountStatus, AdminRole } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { listings, users } from '../../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { userRoom } from '../../socket/rooms.js';
import { adminText } from '../../lib/admin-text.js';
import { writeAudit } from '../audit.service.js';
import { lockListingsInOrder } from '../deals/locks.js';
import { closeChainsForInactiveOwner, openOfferListingIds, reconcileOffersForListing } from '../offers/reconcile.js';

// Account status actions (F1 + A2 spec §8.2, §10; scope A2). One state machine:
//   suspend   active            → suspended   (verification_officer, moderator, super_admin)
//   reinstate suspended         → active      (same roles; a blocked user is 409 USER_BLOCKED)
//   block     active|suspended  → blocked     (super_admin only)
//   unblock   blocked           → active      (super_admin only)
// Every action needs a reason (3–500 characters) and writes one audit row in the caller's transaction. After the
// commit the route calls disconnectUserSockets for suspend and block; requireUser and the socket handshake refuse a
// non-active user from the next request on.
//
// F6 + F7 (spec §7.7, plan L2-4, review I7): suspending or blocking a business's **owner** takes its listings off the
// market (`publicListingWhere`), so their open offers close (`listing_unavailable`) and the chains where the business
// is the buyer close (`account_inactive`). The affected listings are locked in id order before any offer. Other members
// change no offer; reinstating reopens nothing; deals continue. The route runs the action in `runTx` so the queued
// emits flush after commit.

export interface StatusActor {
  id: string;
  role: AdminRole;
}

export interface UserStatusResult {
  id: string;
  status: AccountStatus;
}

type Action = 'suspend' | 'reinstate' | 'block' | 'unblock';

async function transition(
  tx: Tx,
  admin: StatusActor,
  userId: string,
  reason: string,
  action: Action,
  decide: (current: AccountStatus) => AccountStatus,
): Promise<UserStatusResult> {
  const why = adminText(reason);
  // Row lock: two officers acting at once see one state, and the second gets the state-conflict code. `NO KEY UPDATE`
  // (the status isn't a key): it doesn't block the key-share locks that F6 inserts take on this user row (a notification
  // to the owner while the owner's suspension waits for a listing lock would otherwise deadlock).
  const [user] = await tx
    .select({ status: users.status, memberRole: users.memberRole, businessId: users.businessId })
    .from(users)
    .where(eq(users.id, userId))
    .for('no key update');
  if (!user) throw new NotFoundError('User');
  const next = decide(user.status);
  await tx.update(users).set({ status: next, updatedAt: new Date() }).where(eq(users.id, userId));
  if ((action === 'suspend' || action === 'block') && user.memberRole === 'owner' && user.businessId) {
    await closeOffersForInactiveOwner(tx, user.businessId);
  }
  await writeAudit(tx, {
    adminId: admin.id,
    action: `user.${action}`,
    entityType: 'user',
    entityId: userId,
    before: { status: user.status },
    after: { status: next, reason: why },
  });
  return { id: userId, status: next };
}

/**
 * The owner is no longer active (§7.7): lock the business's offerable listings and every listing with an open chain it
 * is a party to, in id order (a concurrent offer on one of them either commits first and is closed here, or waits and
 * then finds the listing no longer public); reconcile its own listings; close its buyer chains.
 */
async function closeOffersForInactiveOwner(tx: Tx, businessId: string): Promise<void> {
  const own = await tx
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.businessId, businessId), inArray(listings.status, ['live', 'reserved'])));
  const locked = await lockListingsInOrder(tx, [...own.map((l) => l.id), ...(await openOfferListingIds(tx, businessId))]);
  for (const listing of locked) {
    if (listing.businessId === businessId) await reconcileOffersForListing(tx, listing.id);
  }
  await closeChainsForInactiveOwner(tx, businessId);
}

function superAdminOnly(admin: StatusActor): void {
  if (admin.role !== 'super_admin') throw new ForbiddenError('Only a super admin can block or unblock an account');
}

export function suspendUser(tx: Tx, admin: StatusActor, userId: string, reason: string): Promise<UserStatusResult> {
  return transition(tx, admin, userId, reason, 'suspend', (current) => {
    if (current !== 'active') throw new ConflictError('Only an active account can be suspended', 'USER_NOT_ACTIVE');
    return 'suspended';
  });
}

export function reinstateUser(tx: Tx, admin: StatusActor, userId: string, reason: string): Promise<UserStatusResult> {
  return transition(tx, admin, userId, reason, 'reinstate', (current) => {
    if (current === 'blocked') {
      throw new ConflictError('This account is blocked. Only a super admin can unblock it.', 'USER_BLOCKED');
    }
    if (current !== 'suspended') throw new ConflictError('This account is not suspended', 'USER_NOT_SUSPENDED');
    return 'active';
  });
}

export async function blockUser(tx: Tx, admin: StatusActor, userId: string, reason: string): Promise<UserStatusResult> {
  superAdminOnly(admin);
  return transition(tx, admin, userId, reason, 'block', (current) => {
    if (current === 'blocked') throw new ConflictError('This account is already blocked', 'USER_NOT_ACTIVE');
    return 'blocked';
  });
}

export async function unblockUser(tx: Tx, admin: StatusActor, userId: string, reason: string): Promise<UserStatusResult> {
  superAdminOnly(admin);
  return transition(tx, admin, userId, reason, 'unblock', (current) => {
    if (current !== 'blocked') throw new ConflictError('This account is not blocked', 'USER_NOT_BLOCKED');
    return 'active';
  });
}

/** Drops every open `/user` socket of this user (all devices). No-op without Socket.IO (tests that don't attach it). */
export function disconnectUserSockets(io: SocketIOServer | undefined, userId: string): void {
  io?.of('/user').in(userRoom(userId)).disconnectSockets(true);
}
