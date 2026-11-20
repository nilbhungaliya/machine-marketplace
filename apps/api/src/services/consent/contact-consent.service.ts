import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  CONSENT_WORDING_VERSION,
  type ConsentPhoneSource,
  type ConsentWithdrawReason,
  type ContactState,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, chatThreads, contactShareConsents, dealEvents, deals, rentalBookings, users } from '../../db/schema.js';
import { ConflictError, ForbiddenError } from '../../lib/errors.js';
import { emitToBusinesses } from '../chat/chat-emit.js';
import { assertCanWrite, type ChatReader, type ThreadRow } from '../chat/members.js';
import { insertSystemLine } from '../chat/thread-lines.js';
import { lockThread } from '../deals/locks.js';
import { bookingLine, recordBookingEvent } from '../rentals/booking-write.js';
import { threadAgreement } from '../rentals/thread-agreement.js';

/**
 * Share my number and the reveal (F6 + F7 spec §5.5, §6.6, R6; ported from textile
 * `services/consent/contact-consent.service.ts`, reshaped to MPM's per-thread consents). Consents are append-only
 * rows: a tick writes a `grant` of the business's **current** number; removing or replacing the number (or an owner
 * change) writes a business-wide `withdraw` of the old one. A consent is **valid** while it is a `grant` in the thread
 * whose `phone_shown` is the business's current number and no later `withdraw` names that number. Validity is read at
 * request time, so a withdraw hides the number everywhere at once.
 *
 * The reveal (`contact_unlocked_at`) needs a deal in the thread and both sides' valid consents; it is set once and never
 * cleared (text stays unmasked after a withdraw or a cancel; only the number block depends on a valid consent).
 */

type Conn = Db | Tx;

/** The number a business would reveal (§5.12): its verified contact number, else the owner's phone. */
export async function currentContactNumber(conn: Conn, businessId: string): Promise<{ phone: string; source: ConsentPhoneSource } | null> {
  const [b] = await conn
    .select({ phone: businesses.contactPhone, verifiedAt: businesses.contactPhoneVerifiedAt })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  if (b?.phone && b.verifiedAt) return { phone: b.phone, source: 'business_contact' };
  const [owner] = await conn
    .select({ phone: users.phone })
    .from(users)
    .where(and(eq(users.businessId, businessId), eq(users.memberRole, 'owner')))
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(1);
  return owner ? { phone: owner.phone, source: 'owner_phone' } : null;
}

/** A valid grant of `phone` by the business in the thread (no withdraw of that number at or after it). */
async function hasValidGrant(conn: Conn, threadId: string, businessId: string, phone: string): Promise<boolean> {
  const { rows } = await conn.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM contact_share_consents g
      WHERE g.kind = 'grant' AND g.thread_id = ${threadId} AND g.business_id = ${businessId} AND g.phone_shown = ${phone}
        AND NOT EXISTS (
          SELECT 1 FROM contact_share_consents w
          WHERE w.kind = 'withdraw' AND w.business_id = ${businessId} AND w.phone_shown = ${phone}
            AND (w.thread_id IS NULL OR w.thread_id = ${threadId})
            AND w.created_at >= g.created_at
        )
    ) AS ok`);
  return rows[0]?.ok === true;
}

/** Whether `businessId`'s consent in the thread is a `grant` of its current number (§5.5). */
export async function validConsent(conn: Db | Tx, threadId: string, businessId: string): Promise<boolean> {
  const current = await currentContactNumber(conn, businessId);
  if (!current) return false;
  return hasValidGrant(conn, threadId, businessId, current.phone);
}

/**
 * Sets `contact_unlocked_at` (with the `contact_shared` system line and the agreement's event) when the thread has an
 * agreement — a deal or a rental booking ever confirmed (M14 R9, `threadAgreement`) — and both sides hold a valid
 * consent. Returns whether the thread is unlocked after the call. Locks the thread (last in §8.5); a caller holding the
 * deal or booking row (accept, confirm) has written it in this transaction.
 */
export async function maybeReveal(tx: Tx, threadId: string): Promise<boolean> {
  const thread = await lockThread(tx, threadId);
  if (thread.contactUnlockedAt !== null) return true;
  const agreement = await threadAgreement(tx, threadId);
  if (!agreement) return false;
  if (!(await validConsent(tx, threadId, thread.buyerBusinessId))) return false;
  if (!(await validConsent(tx, threadId, thread.sellerBusinessId))) return false;

  await tx.update(chatThreads).set({ contactUnlockedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(chatThreads.id, threadId));
  const businessIds = [thread.buyerBusinessId, thread.sellerBusinessId];
  if (agreement.kind === 'deal') {
    const dealId = agreement.id;
    await tx.insert(dealEvents).values({ dealId, code: 'contact_shared', actorSide: 'system', values: {} });
    // Built after the unlock, so its `message:new` (and the inbox row) already reads unmasked for non-viewers.
    await insertSystemLine(tx, threadId, 'contact_shared', { dealId });
    // Every member's open thread refetches: old messages now read unmasked (ids only, R10).
    emitToBusinesses(tx, businessIds, 'thread:updated', { threadId, reason: 'contact_shared' });
    const [deal] = await tx.select({ status: deals.status, version: deals.version }).from(deals).where(eq(deals.id, dealId));
    emitToBusinesses(tx, businessIds, 'deal:updated', { dealId, threadId, status: deal!.status, version: deal!.version });
  } else {
    const bookingId = agreement.id;
    const [b] = await tx
      .select({ ref: rentalBookings.ref, status: rentalBookings.status, version: rentalBookings.version })
      .from(rentalBookings)
      .where(eq(rentalBookings.id, bookingId));
    await recordBookingEvent(tx, bookingId, 'contact_shared', { side: 'system' });
    await bookingLine(tx, threadId, 'contact_shared', { bookingId, ref: b!.ref });
    emitToBusinesses(tx, businessIds, 'thread:updated', { threadId, reason: 'contact_shared' });
    emitToBusinesses(tx, businessIds, 'rental:updated', { bookingId, threadId, status: b!.status, version: b!.version });
  }
  return true;
}

/**
 * The share-my-number block of a thread for a reader (§6.6): each side's valid consent, the reveal, the other side's
 * number while their consent is valid and the reader may see it (never a viewer), and whether the reader may tick.
 */
export async function contactState(conn: Conn, thread: ThreadRow, reader: ChatReader): Promise<ContactState> {
  const other = reader.side === 'buyer' ? thread.sellerBusinessId : thread.buyerBusinessId;
  const mineCurrent = await currentContactNumber(conn, reader.businessId);
  const otherCurrent = await currentContactNumber(conn, other);
  const mine = mineCurrent ? await hasValidGrant(conn, thread.id, reader.businessId, mineCurrent.phone) : false;
  const theirs = otherCurrent ? await hasValidGrant(conn, thread.id, other, otherCurrent.phone) : false;
  const revealed = thread.contactUnlockedAt !== null;
  // A deal or a confirmed rental booking (M14 R9) makes the tick available.
  const agreed = (await threadAgreement(conn, thread.id)) !== null;
  const isViewer = reader.memberRole === 'viewer';
  const ownerPhoneOnly = mineCurrent?.source === 'owner_phone' && reader.memberRole !== 'owner';
  return {
    mine,
    theirs,
    revealed,
    number: revealed && theirs && !isViewer ? otherCurrent!.phone : null,
    canTick: agreed && !isViewer && !mine && mineCurrent !== null && !ownerPhoneOnly,
    ownerOnlyHint: agreed && !isViewer && ownerPhoneOnly,
  };
}

/**
 * `POST /threads/:id/share-contact` (§6.6): a non-viewer member ticks "Share my number with … for this deal". Needs a
 * deal in the thread; on the owner-phone fallback only the owner may tick (`403 OWNER_CONSENT_REQUIRED`). Idempotent
 * while valid. Writes a `grant` of the current number, then `maybeReveal`. Lock order: the latest deal `FOR KEY SHARE`
 * (deal before thread, §8.5, so the deal event's foreign key never waits behind a deal route holding the thread's
 * deal), then the thread.
 */
export async function shareContact(tx: Tx, thread: ThreadRow, reader: ChatReader): Promise<{ revealed: boolean; number: string | null }> {
  assertCanWrite(reader);
  const agreement = await threadAgreement(tx, thread.id);
  if (!agreement) throw new ConflictError('You can share your number once you have a deal or a confirmed booking here', 'NO_DEAL_IN_THREAD');
  // The agreement's row before the thread (§8.5 / M14 §6.7), so its event's foreign key never waits behind a route
  // holding the thread and that row.
  if (agreement.kind === 'deal') await tx.select({ id: deals.id }).from(deals).where(eq(deals.id, agreement.id)).for('key share');
  else await tx.select({ id: rentalBookings.id }).from(rentalBookings).where(eq(rentalBookings.id, agreement.id)).for('key share');
  const locked = await lockThread(tx, thread.id);

  const current = await currentContactNumber(tx, reader.businessId);
  if (!current) throw new ConflictError('Your business has no number to share', 'CONTACT_PHONE_MISSING');
  if (current.source === 'owner_phone' && reader.memberRole !== 'owner') {
    throw new ForbiddenError("Only your business's owner can share the owner's number", 'OWNER_CONSENT_REQUIRED');
  }
  if (!(await hasValidGrant(tx, thread.id, reader.businessId, current.phone))) {
    await tx.insert(contactShareConsents).values({
      kind: 'grant',
      threadId: thread.id,
      businessId: reader.businessId,
      userId: reader.userId,
      phoneShown: current.phone,
      phoneSource: current.source,
      wordingVersion: CONSENT_WORDING_VERSION,
    });
  }
  const revealed = await maybeReveal(tx, locked.id);
  const [fresh] = await tx.select().from(chatThreads).where(eq(chatThreads.id, locked.id));
  const state = await contactState(tx, fresh!, reader);
  return { revealed, number: state.number };
}

/**
 * A business-wide `withdraw` of `phone` (P6): the contact number removed or replaced, or an owner change. That number
 * stops showing in every thread until a side ticks again (which grants the new number). Stored text is untouched.
 */
export async function withdrawContactConsents(
  tx: Tx,
  businessId: string,
  phone: string,
  reason: ConsentWithdrawReason,
  opts: { userId?: string | null; source?: ConsentPhoneSource } = {},
): Promise<void> {
  // Only numbers this business ever granted need a withdraw row.
  const [granted] = await tx
    .select({ id: contactShareConsents.id, source: contactShareConsents.phoneSource })
    .from(contactShareConsents)
    .where(
      and(
        eq(contactShareConsents.businessId, businessId),
        eq(contactShareConsents.phoneShown, phone),
        eq(contactShareConsents.kind, 'grant'),
        isNotNull(contactShareConsents.threadId),
      ),
    )
    .limit(1);
  if (!granted) return;
  await tx.insert(contactShareConsents).values({
    kind: 'withdraw',
    threadId: null,
    businessId,
    userId: opts.userId ?? null,
    phoneShown: phone,
    phoneSource: opts.source ?? granted.source,
    wordingVersion: CONSENT_WORDING_VERSION,
    reason,
  });
}
