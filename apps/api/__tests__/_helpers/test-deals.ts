import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { totalPaise, type DealStatus, type MemberRole, type OfferKind, type OfferStatus, type PartySide } from '@mpm/shared-types';
import { db, type Db, type Tx } from '../../src/db/index.js';
import {
  businessBlocks,
  chatMessages,
  chatThreadUserState,
  chatThreads,
  contactShareConsents,
  dealDisputes,
  dealEvents,
  dealReviews,
  deals,
  idempotencyKeys,
  listings,
  notificationDeliveries,
  notifications,
  offers,
  reports,
  stockHolds,
  units,
  userDevices,
  users,
} from '../../src/db/schema.js';
import { signUserToken } from '../../src/plugins/auth.js';
import { uniqueTestPhone } from './test-users.js';

// F6 + F7 fixtures (plan C0-2). Rows are written directly with SQL consistent with the holds invariant
// (`held_quantity` = Σ active holds), so offer / deal / review tests start from any state without the services.
// Cleanup: `deleteF6Rows` (called by `deleteListingsOf`, `deleteTestListings`, `deleteTestUsers`,
// `deleteTestBusinesses`), so a suite's usual `deleteTestBusinesses` in `afterAll` removes this feature's rows first.

type Conn = Db | Tx;
type ThreadRow = typeof chatThreads.$inferSelect;

/** A second user of a business with the given member role (owner, listing_manager, sales, viewer). */
export async function addTestMember(businessId: string, role: MemberRole): Promise<{ userId: string; token: string }> {
  const [u] = await db
    .insert(users)
    .values({ phone: uniqueTestPhone(), name: `Test ${role}`, businessId, memberRole: role })
    .returning({ id: users.id });
  return { userId: u!.id, token: signUserToken({ userId: u!.id, businessId }) };
}

/** A thread on a listing for a buyer business (seller and kind copied from the listing, as `openOrGetThread` does). */
export async function insertTestThread(
  o: { listingId: string; buyerBusinessId: string; buyerUserId: string },
  conn: Conn = db,
): Promise<ThreadRow> {
  const [l] = await conn
    .select({ businessId: listings.businessId, kind: listings.kind })
    .from(listings)
    .where(eq(listings.id, o.listingId));
  if (!l) throw new Error('insertTestThread: no such listing');
  const [t] = await conn
    .insert(chatThreads)
    .values({
      listingId: o.listingId,
      buyerBusinessId: o.buyerBusinessId,
      sellerBusinessId: l.businessId,
      listingKind: l.kind,
      createdByUserId: o.buyerUserId,
    })
    .returning();
  return t!;
}

export interface TestOfferOptions {
  threadId: string;
  /** Default `pending`. */
  status?: OfferStatus;
  /** Default the side opposite the sender. */
  turn?: PartySide;
  /** Default 0. */
  round?: number;
  /** Default `offer` (`quote` defaults the sender to the seller). */
  kind?: OfferKind;
  pricePerUnitPaise: number;
  quantity: string;
  /** Default buyer (seller for a quote). */
  senderSide?: PartySide;
  /** Default the thread's creator (buyer) or the listing's creator (seller). */
  senderUserId?: string;
  /** Default the row's own id (an opening row). */
  negotiationId?: string;
  previousOfferId?: string | null;
  /** Default the listing's price (null for a quote). */
  askingPricePaise?: number | null;
  /** Default 48. */
  validityHours?: number;
  /** Default now + validity for `pending`, null for `backup`. */
  expiresAt?: Date | null;
  backupSince?: Date | null;
  needsReconfirm?: boolean;
  note?: string | null;
}

/** An offer row in a thread, terms and snapshot copied from the listing. Returns the row. */
export async function insertTestOffer(o: TestOfferOptions, conn: Conn = db): Promise<typeof offers.$inferSelect> {
  const [t] = await conn.select().from(chatThreads).where(eq(chatThreads.id, o.threadId));
  if (!t) throw new Error('insertTestOffer: no such thread');
  const [l] = await conn
    .select({ createdByUserId: listings.createdByUserId, pricePaise: listings.pricePaise, unitId: listings.unitId, gstMode: listings.gstMode })
    .from(listings)
    .where(eq(listings.id, t.listingId));
  const kind = o.kind ?? 'offer';
  const senderSide: PartySide = o.senderSide ?? (kind === 'quote' ? 'seller' : 'buyer');
  const status = o.status ?? 'pending';
  const validityHours = o.validityHours ?? 48;
  const id = randomUUID();
  const expiresAt =
    o.expiresAt !== undefined ? o.expiresAt : status === 'backup' ? null : new Date(Date.now() + validityHours * 3_600_000);
  const [row] = await conn
    .insert(offers)
    .values({
      id,
      threadId: t.id,
      listingId: t.listingId,
      buyerBusinessId: t.buyerBusinessId,
      sellerBusinessId: t.sellerBusinessId,
      negotiationId: o.negotiationId ?? id,
      previousOfferId: o.previousOfferId ?? null,
      round: o.round ?? 0,
      kind,
      senderSide,
      senderUserId: o.senderUserId ?? (senderSide === 'buyer' ? t.createdByUserId : l!.createdByUserId),
      turn: o.turn ?? (senderSide === 'buyer' ? 'seller' : 'buyer'),
      needsReconfirm: o.needsReconfirm ?? false,
      pricePerUnitPaise: o.pricePerUnitPaise,
      quantity: o.quantity,
      totalPaise: totalPaise(o.pricePerUnitPaise, o.quantity),
      askingPricePaise: o.askingPricePaise !== undefined ? o.askingPricePaise : kind === 'quote' ? null : l!.pricePaise,
      unitId: l!.unitId,
      gstMode: l!.gstMode,
      validityHours,
      expiresAt,
      backupSince: o.backupSince ?? (status === 'backup' ? new Date() : null),
      note: o.note ?? null,
      status,
    })
    .returning();
  return row!;
}

export interface TestDeal {
  threadId: string;
  offerId: string;
  dealId: string;
  ref: number;
  holdId: string;
}

/**
 * A deal as accept leaves it, in one transaction: the buyer's thread on the listing (reused when it exists), an
 * accepted buyer offer, the deal (`agreed`), its `active` hold and `held_quantity += quantity`, `deal_count + 1`.
 * - `handed_over`: handed over now, problem deadline now + 2 d, auto-complete now + 3 d.
 * - `disputed`: handed over now, timers stopped, hold active (add the dispute row yourself).
 * - `completed`: completed now (`buyer_confirmed`), hold `converted`: quantity down, `held_quantity` back.
 * - `cancelled`: cancelled now (`buyer`, `no_longer_needed`), hold `released`, `held_quantity` back.
 */
export async function insertTestDeal(o: {
  listing: { id: string };
  buyer: { businessId: string; userId: string };
  quantity: string;
  pricePerUnitPaise: number;
  status?: DealStatus;
}): Promise<TestDeal> {
  const status = o.status ?? 'agreed';
  return db.transaction(async (tx) => {
    const [l] = await tx
      .select({
        title: listings.title,
        unitId: listings.unitId,
        gstMode: listings.gstMode,
        sellerUserId: listings.createdByUserId,
        unitLabel: units.label,
      })
      .from(listings)
      .leftJoin(units, eq(units.id, listings.unitId))
      .where(eq(listings.id, o.listing.id))
      .for('update', { of: listings });
    if (!l) throw new Error('insertTestDeal: no such listing');

    const [existing] = await tx
      .select()
      .from(chatThreads)
      .where(and(eq(chatThreads.listingId, o.listing.id), eq(chatThreads.buyerBusinessId, o.buyer.businessId)));
    const thread =
      existing ?? (await insertTestThread({ listingId: o.listing.id, buyerBusinessId: o.buyer.businessId, buyerUserId: o.buyer.userId }, tx));

    const offer = await insertTestOffer(
      { threadId: thread.id, status: 'accepted', pricePerUnitPaise: o.pricePerUnitPaise, quantity: o.quantity, expiresAt: null },
      tx,
    );
    await tx.update(offers).set({ answeredAt: sql`now()`, answeredByUserId: l.sellerUserId }).where(eq(offers.id, offer.id));

    const handedOver = status === 'handed_over' || status === 'disputed' || status === 'completed';
    const [deal] = await tx
      .insert(deals)
      .values({
        threadId: thread.id,
        listingId: o.listing.id,
        offerId: offer.id,
        buyerBusinessId: o.buyer.businessId,
        sellerBusinessId: thread.sellerBusinessId,
        listingTitle: l.title ?? 'Test listing',
        unitId: l.unitId,
        unitLabel: l.unitLabel ?? 'units',
        gstMode: l.gstMode,
        pricePerUnitPaise: o.pricePerUnitPaise,
        quantity: o.quantity,
        totalPaise: offer.totalPaise,
        status,
        acceptedByUserId: l.sellerUserId,
        handedOverAt: handedOver ? sql`now()` : null,
        handedOverByUserId: handedOver ? l.sellerUserId : null,
        problemDeadlineAt: status === 'handed_over' ? sql`now() + interval '2 days'` : null,
        autoCompleteAt: status === 'handed_over' ? sql`now() + interval '3 days'` : null,
        completedAt: status === 'completed' ? sql`now()` : null,
        completedHow: status === 'completed' ? 'buyer_confirmed' : null,
        cancelledAt: status === 'cancelled' ? sql`now()` : null,
        cancelledBySide: status === 'cancelled' ? 'buyer' : null,
        cancelReason: status === 'cancelled' ? 'no_longer_needed' : null,
      })
      .returning({ id: deals.id, ref: deals.ref });

    const holdStatus = status === 'completed' ? 'converted' : status === 'cancelled' ? 'released' : 'active';
    const [hold] = await tx
      .insert(stockHolds)
      .values({
        listingId: o.listing.id,
        dealId: deal!.id,
        quantity: o.quantity,
        status: holdStatus,
        settledAt: holdStatus === 'active' ? null : sql`now()`,
      })
      .returning({ id: stockHolds.id });

    if (holdStatus === 'active') {
      await tx
        .update(listings)
        .set({ heldQuantity: sql`${listings.heldQuantity} + ${o.quantity}::numeric` })
        .where(eq(listings.id, o.listing.id));
    } else if (holdStatus === 'converted') {
      await tx
        .update(listings)
        .set({ quantity: sql`${listings.quantity} - ${o.quantity}::numeric` })
        .where(eq(listings.id, o.listing.id));
    }

    await tx
      .update(chatThreads)
      .set({ dealCount: sql`${chatThreads.dealCount} + 1`, firstSellerReplyAt: sql`coalesce(${chatThreads.firstSellerReplyAt}, now())` })
      .where(eq(chatThreads.id, thread.id));

    return { threadId: thread.id, offerId: offer.id, dealId: deal!.id, ref: deal!.ref, holdId: hold!.id };
  });
}

/** Throws unless `held_quantity` = Σ active holds and 0 ≤ held ≤ quantity (Review focus 2). */
export async function assertHeldInvariant(listingId: string, conn: Conn = db): Promise<void> {
  const { rows } = await conn.execute(sql`
    SELECT l.held_quantity::text AS held, l.quantity::text AS quantity,
           coalesce((SELECT sum(h.quantity) FROM stock_holds h WHERE h.listing_id = l.id AND h.status = 'active'), 0)::text AS active
    FROM listings l WHERE l.id = ${listingId}`);
  const r = rows[0] as { held: string; quantity: string | null; active: string } | undefined;
  if (!r) throw new Error(`assertHeldInvariant: no listing ${listingId}`);
  const held = Number(r.held);
  if (held !== Number(r.active)) throw new Error(`held_quantity ${r.held} ≠ active holds ${r.active} on ${listingId}`);
  if (held < 0 || (r.quantity !== null && held > Number(r.quantity)) || (r.quantity === null && held !== 0)) {
    throw new Error(`held_quantity ${r.held} out of range (quantity ${r.quantity}) on ${listingId}`);
  }
}

const ids = <T extends { id: string }>(rows: T[]): string[] => rows.map((r) => r.id);

/**
 * Deletes every F6 + F7 row tied to the given businesses, users or listings, deepest foreign key first: consents (in a
 * transaction or savepoint of their own that sets `mpm.consent_purge`, P5), deliveries, notifications, devices, reports on
 * those conversations / reviews, messages, reviews, disputes, deal events, holds, deals, offers, thread user state,
 * threads, blocks, and idempotency keys whose scope ends in one of the user ids. No-op when every list is empty.
 */
export async function deleteF6Rows(
  conn: Conn,
  opts: { businessIds: string[]; userIds: string[]; listingIds?: string[] },
): Promise<void> {
  const { businessIds, userIds } = opts;
  const listingIds = opts.listingIds ?? [];
  if (businessIds.length === 0 && userIds.length === 0 && listingIds.length === 0) return;

  const threadWhere: SQL[] = [];
  if (businessIds.length) {
    threadWhere.push(inArray(chatThreads.buyerBusinessId, businessIds), inArray(chatThreads.sellerBusinessId, businessIds));
  }
  if (listingIds.length) threadWhere.push(inArray(chatThreads.listingId, listingIds));
  if (userIds.length) threadWhere.push(inArray(chatThreads.createdByUserId, userIds));
  const threadIds = threadWhere.length ? ids(await conn.select({ id: chatThreads.id }).from(chatThreads).where(or(...threadWhere))) : [];

  const dealWhere: SQL[] = [];
  if (threadIds.length) dealWhere.push(inArray(deals.threadId, threadIds));
  if (listingIds.length) dealWhere.push(inArray(deals.listingId, listingIds));
  if (businessIds.length) dealWhere.push(inArray(deals.buyerBusinessId, businessIds), inArray(deals.sellerBusinessId, businessIds));
  const dealIds = dealWhere.length ? ids(await conn.select({ id: deals.id }).from(deals).where(or(...dealWhere))) : [];

  const reviewWhere: SQL[] = [];
  if (dealIds.length) reviewWhere.push(inArray(dealReviews.dealId, dealIds));
  if (businessIds.length) {
    reviewWhere.push(inArray(dealReviews.reviewerBusinessId, businessIds), inArray(dealReviews.reviewedBusinessId, businessIds));
  }
  const reviewIds = reviewWhere.length ? ids(await conn.select({ id: dealReviews.id }).from(dealReviews).where(or(...reviewWhere))) : [];

  const offerIds = threadIds.length ? ids(await conn.select({ id: offers.id }).from(offers).where(inArray(offers.threadId, threadIds))) : [];

  // Consents first, in a transaction (or savepoint) of their own: the purge flag is SET LOCAL.
  const consentWhere: SQL[] = [];
  if (businessIds.length) consentWhere.push(inArray(contactShareConsents.businessId, businessIds));
  if (threadIds.length) consentWhere.push(inArray(contactShareConsents.threadId, threadIds));
  if (userIds.length) consentWhere.push(inArray(contactShareConsents.userId, userIds));
  if (consentWhere.length) {
    await conn.transaction(async (t) => {
      await t.execute(sql`SELECT set_config('mpm.consent_purge', 'on', true)`);
      await t.delete(contactShareConsents).where(or(...consentWhere));
      await t.execute(sql`SELECT set_config('mpm.consent_purge', 'off', true)`);
    });
  }

  const notificationWhere: SQL[] = [];
  if (userIds.length) notificationWhere.push(inArray(notifications.userId, userIds));
  if (businessIds.length) notificationWhere.push(inArray(notifications.businessId, businessIds));
  if (threadIds.length) notificationWhere.push(inArray(notifications.threadId, threadIds));
  if (dealIds.length) notificationWhere.push(inArray(notifications.dealId, dealIds));
  if (reviewIds.length) notificationWhere.push(inArray(notifications.reviewId, reviewIds));
  if (offerIds.length) notificationWhere.push(inArray(notifications.offerId, offerIds));
  const deviceIds = userIds.length ? ids(await conn.select({ id: userDevices.id }).from(userDevices).where(inArray(userDevices.userId, userIds))) : [];
  if (notificationWhere.length) {
    const notificationIds = ids(await conn.select({ id: notifications.id }).from(notifications).where(or(...notificationWhere)));
    if (notificationIds.length) await conn.delete(notificationDeliveries).where(inArray(notificationDeliveries.notificationId, notificationIds));
    if (notificationIds.length) await conn.delete(notifications).where(inArray(notifications.id, notificationIds));
  }
  if (deviceIds.length) {
    await conn.delete(notificationDeliveries).where(inArray(notificationDeliveries.deviceId, deviceIds));
    await conn.delete(userDevices).where(inArray(userDevices.id, deviceIds));
  }

  const reportWhere: SQL[] = [];
  if (threadIds.length) reportWhere.push(and(eq(reports.targetType, 'conversation'), inArray(reports.targetId, threadIds))!);
  if (reviewIds.length) reportWhere.push(and(sql`${reports.targetType} = 'review'`, inArray(reports.targetId, reviewIds))!);
  if (reportWhere.length) await conn.delete(reports).where(or(...reportWhere));

  if (threadIds.length) await conn.delete(chatMessages).where(inArray(chatMessages.threadId, threadIds));
  if (userIds.length) await conn.delete(chatMessages).where(inArray(chatMessages.senderUserId, userIds));
  if (reviewIds.length) await conn.delete(dealReviews).where(inArray(dealReviews.id, reviewIds));
  if (dealIds.length) {
    await conn.delete(dealDisputes).where(inArray(dealDisputes.dealId, dealIds));
    await conn.delete(dealEvents).where(inArray(dealEvents.dealId, dealIds));
    await conn.delete(stockHolds).where(inArray(stockHolds.dealId, dealIds));
    await conn.delete(deals).where(inArray(deals.id, dealIds));
  }
  if (listingIds.length) await conn.delete(stockHolds).where(inArray(stockHolds.listingId, listingIds));
  if (threadIds.length) {
    await conn.delete(offers).where(inArray(offers.threadId, threadIds));
    await conn.delete(chatThreadUserState).where(inArray(chatThreadUserState.threadId, threadIds));
  }
  if (userIds.length) await conn.delete(chatThreadUserState).where(inArray(chatThreadUserState.userId, userIds));
  if (threadIds.length) await conn.delete(chatThreads).where(inArray(chatThreads.id, threadIds));

  const blockWhere: SQL[] = [];
  if (businessIds.length) {
    blockWhere.push(inArray(businessBlocks.blockerBusinessId, businessIds), inArray(businessBlocks.blockedBusinessId, businessIds));
  }
  if (userIds.length) blockWhere.push(inArray(businessBlocks.createdByUserId, userIds));
  if (blockWhere.length) await conn.delete(businessBlocks).where(or(...blockWhere));

  for (const userId of userIds) await conn.delete(idempotencyKeys).where(like(idempotencyKeys.scope, `%:${userId}`));
}
