import { and, count, eq, gte, or, sql } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { businessBlocks, chatThreads, listings, users } from '../../db/schema.js';
import { ConflictError, ForbiddenError, TooManyRequestsError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { listingNotFound } from '../listings/locks.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import { getSettings } from '../settings.service.js';
import { lockBuyerBusiness } from '../deals/locks.js';
import type { ChatReader, ThreadRow } from './members.js';

/**
 * Opens the thread for (listing, buyer business), or returns the one that exists (F6 + F7 spec §6.1). Shared by L1's
 * enquiry and L2's offer / buy-now routes. Refusals, in order:
 * `404 LISTING_NOT_FOUND` (not public, `publicListingWhere`), `409 ONBOARDING_INCOMPLETE` (no business yet),
 * `409 OWN_LISTING`, `403 VIEWER_READ_ONLY`, `403 BUSINESS_BLOCKED` (a block either way). Then the buyer business is
 * locked (`FOR NO KEY UPDATE`, first in §8.5) and, for a new thread only, the daily limit is checked (threads the
 * business created since midnight IST vs `enquiry_new_per_day_{unverified,verified}` → `429 ENQUIRY_LIMIT`). The insert
 * is `ON CONFLICT (listing_id, buyer_business_id) DO NOTHING`, so two first taps make one thread. The thread is not
 * locked here: a caller that needs it locks the listing first (§8.5), then the thread.
 */
export async function openOrGetThread(
  tx: Tx,
  user: UserTokenPayload,
  listingId: string,
): Promise<{ thread: ThreadRow; reader: ChatReader; created: boolean }> {
  const [listing] = await tx
    .select({ id: listings.id, businessId: listings.businessId, kind: listings.kind })
    .from(listings)
    .where(and(eq(listings.id, listingId), publicListingWhere()));
  if (!listing) throw listingNotFound();
  if (!user.businessId) throw new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
  const buyerBusinessId = user.businessId;
  if (listing.businessId === buyerBusinessId) throw new ConflictError("This is your own listing", 'OWN_LISTING');

  const [member] = await tx.select({ memberRole: users.memberRole }).from(users).where(eq(users.id, user.userId));
  if (!member || member.memberRole === 'viewer') throw new ForbiddenError('Viewers can read but not write', 'VIEWER_READ_ONLY');

  const [block] = await tx
    .select({ one: sql<number>`1` })
    .from(businessBlocks)
    .where(
      or(
        and(eq(businessBlocks.blockerBusinessId, buyerBusinessId), eq(businessBlocks.blockedBusinessId, listing.businessId)),
        and(eq(businessBlocks.blockerBusinessId, listing.businessId), eq(businessBlocks.blockedBusinessId, buyerBusinessId)),
      ),
    )
    .limit(1);
  if (block) throw new ForbiddenError("You can't message this business", 'BUSINESS_BLOCKED');

  const business = await lockBuyerBusiness(tx, buyerBusinessId);
  const reader: ChatReader = { userId: user.userId, businessId: buyerBusinessId, memberRole: member.memberRole, side: 'buyer' };

  const existing = await findThread(tx, listingId, buyerBusinessId);
  if (existing) return { thread: existing, reader, created: false };

  const settings = await getSettings(tx);
  const verified = business.verificationLevels.includes('gst');
  const max = verified ? settings.enquiry_new_per_day_verified : settings.enquiry_new_per_day_unverified;
  const istMidnight = sql`(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
  const [today] = await tx
    .select({ n: count() })
    .from(chatThreads)
    .where(and(eq(chatThreads.buyerBusinessId, buyerBusinessId), gte(chatThreads.createdAt, istMidnight)));
  if ((today?.n ?? 0) >= max) {
    const { rows } = await tx.execute(sql`SELECT (${istMidnight} + interval '1 day') AS retry_at`);
    const retryAt = new Date((rows[0] as { retry_at: string | Date }).retry_at).toISOString();
    throw new TooManyRequestsError('You have started many new enquiries today. Try again tomorrow.', 'ENQUIRY_LIMIT', { retryAt, limit: max });
  }

  const inserted = await tx
    .insert(chatThreads)
    .values({
      listingId,
      buyerBusinessId,
      sellerBusinessId: listing.businessId,
      listingKind: listing.kind,
      createdByUserId: user.userId,
    })
    .onConflictDoNothing({ target: [chatThreads.listingId, chatThreads.buyerBusinessId] })
    .returning();
  if (inserted[0]) return { thread: inserted[0], reader, created: true };
  // Another transaction inserted it first (the buyer business lock makes this rare: a different business user's tap).
  const thread = await findThread(tx, listingId, buyerBusinessId);
  return { thread: thread!, reader, created: false };
}

async function findThread(tx: Tx, listingId: string, buyerBusinessId: string): Promise<ThreadRow | undefined> {
  const [row] = await tx
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.listingId, listingId), eq(chatThreads.buyerBusinessId, buyerBusinessId)));
  return row;
}
