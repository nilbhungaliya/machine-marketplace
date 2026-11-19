import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  dealYourTurn,
  milliToQuantity,
  quantityToMilli,
  type ContactState,
  type Counterpart,
  type DealAction,
  type DealCancelReason,
  type DealDisputeSummary,
  type DealListRow,
  type DealTimelineEntry,
  type DealView,
  type PartySide,
  type SignedPhoto,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, chatThreads, contactShareConsents, dealDisputes, dealEvents, deals, listingMedia, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { publicUrl } from '../../lib/media-url.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { publicText, visibleText } from '../chat/chat-view.js';
import type { ChatReader } from '../chat/members.js';
import { privatePhotoUrl } from '../chat/private-photo.js';
import { validConsent } from '../consent/contact-consent.service.js';
import { dealActions } from './deal-actions.js';

/**
 * Deal views per reader (F6 + F7 spec §9.1, §12.2; ported from textile `services/deals/deal-view.ts` `getDeal`,
 * `toDealListRow`). Every user-written text (notes, handover and cancel notes, dispute description) leaves through
 * `visibleText` (R6); listing titles and business names through `publicText` (masked always). Party checks read the
 * reader's business and role from the database and answer `404 DEAL_NOT_FOUND` to outsiders.
 */

type Conn = Db | Tx;
export type DealRow = typeof deals.$inferSelect;
type ThreadRow = typeof chatThreads.$inferSelect;

export function dealNotFound(): AppError {
  return new AppError('Deal not found', 404, 'DEAL_NOT_FOUND');
}

/** The database clock (every rule uses `now()`, plan Global constraints). */
export async function dbNow(conn: Conn): Promise<Date> {
  const { rows } = await conn.execute(sql`SELECT now() AS now`);
  return new Date((rows[0] as { now: string | Date }).now);
}

/** The caller as a reader of a deal: business and role from the `users` row. Null without a business. */
export async function readerFor(conn: Conn, user: UserTokenPayload): Promise<Omit<ChatReader, 'side'> | null> {
  const [row] = await conn
    .select({ businessId: users.businessId, memberRole: users.memberRole })
    .from(users)
    .where(eq(users.id, user.userId));
  if (!row?.businessId) return null;
  return { userId: user.userId, businessId: row.businessId, memberRole: row.memberRole };
}

export function sideOfDeal(deal: Pick<DealRow, 'buyerBusinessId' | 'sellerBusinessId'>, businessId: string): PartySide | null {
  if (deal.buyerBusinessId === businessId) return 'buyer';
  if (deal.sellerBusinessId === businessId) return 'seller';
  return null;
}

/** The deal (unlocked) and the caller as a reader; `404 DEAL_NOT_FOUND` for a deal that isn't the caller's business's. */
export async function dealForParty(conn: Conn, user: UserTokenPayload, dealId: string): Promise<{ deal: DealRow; reader: ChatReader }> {
  const base = await readerFor(conn, user);
  if (!base) throw dealNotFound();
  const [deal] = await conn.select().from(deals).where(eq(deals.id, dealId));
  const side = deal ? sideOfDeal(deal, base.businessId) : null;
  if (!deal || !side) throw dealNotFound();
  return { deal, reader: { ...base, side } };
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const trimQty = (q: string): string => milliToQuantity(quantityToMilli(q));

async function counterpartsOf(conn: Conn, ids: string[]): Promise<Map<string, Counterpart>> {
  if (ids.length === 0) return new Map();
  const rows = await conn
    .select({ id: businesses.id, name: businesses.tradeName, levels: businesses.verificationLevels })
    .from(businesses)
    .where(inArray(businesses.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, { businessId: r.id, name: publicText(r.name) ?? '', gstVerified: r.levels.includes('gst') }]));
}

async function thumbsOf(conn: Conn, listingIds: string[]): Promise<Map<string, string | null>> {
  if (listingIds.length === 0) return new Map();
  const rows = await conn
    .selectDistinctOn([listingMedia.listingId], { listingId: listingMedia.listingId, thumbKey: listingMedia.thumbKey })
    .from(listingMedia)
    .where(and(inArray(listingMedia.listingId, [...new Set(listingIds)]), eq(listingMedia.type, 'photo')))
    .orderBy(listingMedia.listingId, asc(listingMedia.sortOrder), asc(listingMedia.createdAt));
  return new Map(rows.map((r) => [r.listingId, publicUrl(r.thumbKey)]));
}

function listRow(deal: DealRow, side: PartySide, counterpart: Counterpart, thumbUrl: string | null): DealListRow {
  return {
    id: deal.id,
    ref: deal.ref,
    threadId: deal.threadId,
    listingId: deal.listingId,
    side,
    counterpart,
    listingTitle: publicText(deal.listingTitle) ?? '',
    thumbUrl,
    pricePerUnitPaise: deal.pricePerUnitPaise,
    quantity: trimQty(deal.quantity),
    unitLabel: deal.unitLabel,
    totalPaise: deal.totalPaise.toString(),
    gstMode: deal.gstMode,
    status: deal.status,
    yourTurn: dealYourTurn(deal, side),
    acceptedAt: deal.acceptedAt.toISOString(),
    handedOverAt: iso(deal.handedOverAt),
    autoCompleteAt: iso(deal.autoCompleteAt),
    completedAt: iso(deal.completedAt),
    cancelledAt: iso(deal.cancelledAt),
    updatedAt: deal.updatedAt.toISOString(),
  };
}

/** `DealListRow`s for one business (the Deals tab, a thread's deals), in the order given. */
export async function toDealListRows(conn: Conn, rows: DealRow[], businessId: string): Promise<DealListRow[]> {
  const otherId = (d: DealRow) => (d.buyerBusinessId === businessId ? d.sellerBusinessId : d.buyerBusinessId);
  const names = await counterpartsOf(conn, rows.map(otherId));
  const thumbs = await thumbsOf(conn, rows.map((d) => d.listingId));
  return rows.map((d) =>
    listRow(d, sideOfDeal(d, businessId) ?? 'buyer', names.get(otherId(d)) ?? { businessId: otherId(d), name: '', gstVerified: false }, thumbs.get(d.listingId) ?? null),
  );
}

/** A 300 s signed URL, or null when storage can't sign it now (a read never fails on a photo). */
async function signed(key: string | null): Promise<SignedPhoto | null> {
  if (!key) return null;
  try {
    return await privatePhotoUrl(key);
  } catch {
    return null;
  }
}

async function signedAll(keys: string[]): Promise<SignedPhoto[]> {
  const out: SignedPhoto[] = [];
  for (const key of keys) {
    const photo = await signed(key);
    if (photo) out.push(photo);
  }
  return out;
}

/** The latest valid grant's number of a business in a thread (the number shown is the one consented to, §5.5). */
async function grantedNumber(conn: Conn, threadId: string, businessId: string): Promise<string | null> {
  const [row] = await conn
    .select({ phone: contactShareConsents.phoneShown })
    .from(contactShareConsents)
    .where(and(eq(contactShareConsents.threadId, threadId), eq(contactShareConsents.businessId, businessId), eq(contactShareConsents.kind, 'grant')))
    .orderBy(desc(contactShareConsents.createdAt))
    .limit(1);
  return row?.phone ?? null;
}

/**
 * The contact block on the Deal record (§6.6): `revealed` from the thread (set once, permanent); each side's tick read
 * at request time through `validConsent` (a grant of that business's current number); the other side's number only
 * once revealed, while their consent is valid, and never for a `viewer`. The tick is offered to non-viewers, and on the
 * owner-phone fallback (no verified contact number) only to the owner.
 */
export async function dealContactState(conn: Conn, thread: ThreadRow, reader: ChatReader): Promise<ContactState> {
  const otherId = reader.side === 'buyer' ? thread.sellerBusinessId : thread.buyerBusinessId;
  const mine = await validConsent(conn, thread.id, reader.businessId);
  const theirs = await validConsent(conn, thread.id, otherId);
  const revealed = thread.contactUnlockedAt !== null;
  const viewer = reader.memberRole === 'viewer';
  const [business] = await conn
    .select({ phone: businesses.contactPhone, verifiedAt: businesses.contactPhoneVerifiedAt })
    .from(businesses)
    .where(eq(businesses.id, reader.businessId));
  const hasContactNumber = !!business?.phone && business.verifiedAt !== null;
  const owner = reader.memberRole === 'owner';
  return {
    mine,
    theirs,
    revealed,
    number: revealed && theirs && !viewer ? await grantedNumber(conn, thread.id, otherId) : null,
    canTick: !viewer && (hasContactNumber || owner),
    ownerOnlyHint: !viewer && !hasContactNumber && !owner,
  };
}

async function timelineOf(conn: Conn, dealId: string): Promise<DealTimelineEntry[]> {
  const rows = await conn.select().from(dealEvents).where(eq(dealEvents.dealId, dealId)).orderBy(asc(dealEvents.createdAt), asc(dealEvents.id));
  return rows.map((e) => ({ code: e.code, actorSide: e.actorSide, values: e.values, at: e.createdAt.toISOString() }));
}

async function disputeOf(conn: Conn, deal: DealRow, reader: ChatReader, thread: ThreadRow): Promise<DealDisputeSummary | null> {
  // The open one, else the latest (a resumed deal can be disputed again, §9.2).
  const [d] = await conn
    .select()
    .from(dealDisputes)
    .where(eq(dealDisputes.dealId, deal.id))
    .orderBy(sql`(${dealDisputes.status} = 'open') DESC`, desc(dealDisputes.createdAt))
    .limit(1);
  if (!d) return null;
  return {
    id: d.id,
    category: d.category,
    description: visibleText(d.description, reader, thread) ?? '',
    photos: await signedAll(d.photoKeys),
    openedBySide: d.openedBySide,
    status: d.status,
    outcome: d.outcome,
    messageToParties: d.messageToParties,
    createdAt: d.createdAt.toISOString(),
    resolvedAt: iso(d.resolvedAt),
  };
}

/** Which side last saved the notes (for the scam warning: only the other side's text warns, §6.7). */
async function notesSideOf(conn: Conn, deal: DealRow): Promise<PartySide | null> {
  if (!deal.notesUpdatedByUserId) return null;
  const [u] = await conn.select({ businessId: users.businessId }).from(users).where(eq(users.id, deal.notesUpdatedByUserId));
  return u?.businessId ? sideOfDeal(deal, u.businessId) : null;
}

/** The Deal record for one reader (`GET /deals/:id` and every action's reply). `now` is the database clock. */
export async function buildDealView(conn: Conn, deal: DealRow, reader: ChatReader, now: Date): Promise<DealView> {
  const [thread] = await conn.select().from(chatThreads).where(eq(chatThreads.id, deal.threadId));
  if (!thread) throw dealNotFound();
  const [row] = await toDealListRows(conn, [deal], reader.businessId);
  const notesSide = await notesSideOf(conn, deal);
  const contact = await dealContactState(conn, thread, reader);

  const actions: DealAction[] = [...dealActions(deal, reader.side, reader.memberRole, now)];
  if (contact.canTick && !contact.mine && deal.status !== 'cancelled') actions.push('share_contact');

  return {
    ...row!,
    version: deal.version,
    memberRole: reader.memberRole,
    notes: {
      paymentMethod: deal.paymentMethod,
      advancePaise: deal.advancePaise === null ? null : deal.advancePaise.toString(),
      balancePaise: deal.advancePaise === null ? null : (deal.totalPaise - deal.advancePaise).toString(),
      fulfilment: deal.fulfilment,
      expectedOn: deal.expectedOn,
      text: visibleText(deal.notesText, reader, thread),
      scamWarning: deal.notesScamFlag && notesSide !== null && notesSide !== reader.side,
      updatedAt: iso(deal.notesUpdatedAt),
      updatedBySide: notesSide,
    },
    timeline: await timelineOf(conn, deal.id),
    actions,
    contact,
    problemDeadlineAt: iso(deal.problemDeadlineAt),
    handover: deal.handedOverAt
      ? { at: deal.handedOverAt.toISOString(), note: visibleText(deal.handoverNote, reader, thread), photo: await signed(deal.handoverPhotoKey) }
      : null,
    cancelRequest:
      deal.cancelRequestedSide && deal.cancelRequestedAt
        ? { side: deal.cancelRequestedSide, reason: (deal.cancelRequestedReason as DealCancelReason | null) ?? null, at: deal.cancelRequestedAt.toISOString() }
        : null,
    completedHow: deal.completedHow,
    cancelledBySide: deal.cancelledBySide,
    cancelReason: (deal.cancelReason as DealCancelReason | null) ?? null,
    cancelNote: visibleText(deal.cancelNote, reader, thread),
    dispute: await disputeOf(conn, deal, reader, thread),
    // L4 (reviews) fills the review card; null until then.
    review: null,
  };
}
