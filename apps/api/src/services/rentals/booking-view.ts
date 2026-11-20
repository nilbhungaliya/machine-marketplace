import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  rentalBookingActions,
  rentalYourTurn,
  type MemberRole,
  type PartySide,
  type RentalBookingCardView,
  type RentalBookingListRow,
  type RentalBookingView,
  type RentalVersionView,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, chatThreads, dealDisputes, listingMedia, rentalBookingEvents, rentalBookingVersions, rentalBookings } from '../../db/schema.js';
import { maskContact } from '../../lib/mask-contact.js';
import { publicUrl } from '../../lib/media-url.js';
import { publicText, visibleText } from '../chat/chat-view.js';
import type { ChatReader, ThreadRow } from '../chat/members.js';
import { contactState } from '../consent/contact-consent.service.js';
import { getRentalReviewState } from '../reviews/rental-review.service.js';
import { getSettings } from '../settings.service.js';
import { clashWithFor } from './capacity.js';
import type { RentalBookingRow } from './locks.js';

/**
 * The Booking record per reader (M14 spec §8, §13.2, §18; plan D4, A1-4): one builder for the detail (`toBookingView`),
 * the list rows (`toBookingListRows`) and the thread's booking cards (`bookingCardViews`). Text a user typed (version
 * messages, notes, damage / final / cancel notes) leaves through `visibleText` (masked until the thread's reveal, always
 * for a `viewer`); titles and names through `publicText` (always masked). **Site address:** the renter's own members
 * always (a `viewer` masked), the owner's members only once `confirmed_at` is set and then masked until the reveal; the
 * owner gets the distance in whole km, the renter never.
 */

type Conn = Db | Tx;
type VersionRow = typeof rentalBookingVersions.$inferSelect;

export type BookingSide = 'renter' | 'owner';

/** Who reads a booking: a member of the renter or the owner business. */
export interface BookingReader {
  userId: string;
  businessId: string;
  memberRole: MemberRole;
  side: BookingSide;
}

/** The thread reader of a booking reader (the renter is the thread's buyer, the owner its seller). */
export function chatReaderOf(r: BookingReader): ChatReader {
  const side: PartySide = r.side === 'renter' ? 'buyer' : 'seller';
  return { userId: r.userId, businessId: r.businessId, memberRole: r.memberRole, side };
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toVersionView(v: VersionRow, reader: Pick<ChatReader, 'memberRole'>, thread: Pick<ThreadRow, 'contactUnlockedAt'>): RentalVersionView {
  return {
    seq: v.seq,
    proposedBy: v.proposedBySide,
    startDate: v.startDate,
    endDate: v.endDate,
    period: v.period,
    count: v.periodCount,
    machines: v.machines,
    withOperator: v.withOperator,
    ownerDelivers: v.ownerDelivers,
    estimatePaise: Number(v.estimatePaise),
    totalPaise: Number(v.totalPaise),
    message: visibleText(v.message, reader, thread),
    messageFlagged: v.messageScamFlag,
    createdAt: v.createdAt.toISOString(),
  };
}

async function thumbOf(conn: Conn, listingIds: string[]): Promise<Map<string, string | null>> {
  if (listingIds.length === 0) return new Map();
  const rows = await conn
    .selectDistinctOn([listingMedia.listingId], { listingId: listingMedia.listingId, thumbKey: listingMedia.thumbKey })
    .from(listingMedia)
    .where(sql`${listingMedia.listingId} IN (${sql.join([...new Set(listingIds)].map((id) => sql`${id}::uuid`), sql`, `)}) AND ${listingMedia.type} = 'photo'`)
    .orderBy(listingMedia.listingId, listingMedia.sortOrder, listingMedia.createdAt);
  return new Map(rows.map((r) => [r.listingId, publicUrl(r.thumbKey)]));
}

/**
 * The site address for a reader (§8): the renter's members always (a viewer masked); the owner's members from
 * `confirmed_at` on, through `visibleText` (masked until the reveal, always for a viewer); null otherwise.
 */
export function siteAddressFor(b: Pick<RentalBookingRow, 'siteAddress' | 'confirmedAt'>, reader: BookingReader, thread: Pick<ThreadRow, 'contactUnlockedAt'>): string | null {
  if (b.siteAddress === null) return null;
  if (reader.side === 'renter') return reader.memberRole === 'viewer' ? maskContact(b.siteAddress) : b.siteAddress;
  if (b.confirmedAt === null) return null;
  return visibleText(b.siteAddress, reader, thread);
}

/** `GET /rental-bookings/:id` for one reader. `today` is the IST date (actions). */
export async function toBookingView(conn: Conn, b: RentalBookingRow, reader: BookingReader, today: string): Promise<RentalBookingView> {
  const [thread] = await conn.select().from(chatThreads).where(eq(chatThreads.id, b.threadId));
  if (!thread) throw new Error(`thread ${b.threadId} missing`);
  const chat = chatReaderOf(reader);
  const versionRows = await conn
    .select()
    .from(rentalBookingVersions)
    .where(eq(rentalBookingVersions.bookingId, b.id))
    .orderBy(asc(rentalBookingVersions.seq));
  const versions = versionRows.map((v) => toVersionView(v, chat, thread));
  const currentRow = versionRows.find((v) => v.id === b.currentVersionId) ?? versionRows[versionRows.length - 1]!;
  const current = toVersionView(currentRow, chat, thread);

  const counterpartId = reader.side === 'renter' ? b.ownerBusinessId : b.renterBusinessId;
  const [cp] = await conn
    .select({ id: businesses.id, name: businesses.tradeName, levels: businesses.verificationLevels, city: businesses.city })
    .from(businesses)
    .where(eq(businesses.id, counterpartId));

  const { rows: geo } = await conn.execute<{ km: number | null; beyond: boolean | null }>(sql`
    SELECT floor(ST_Distance(COALESCE(l.point, l.search_point), b.site_point) / 1000)::int AS km,
      CASE WHEN (b.terms_snapshot->>'serviceRadiusKm') IS NULL THEN NULL
        ELSE ST_Distance(COALESCE(l.point, l.search_point), b.site_point) > (b.terms_snapshot->>'serviceRadiusKm')::numeric * 1000 END AS beyond
    FROM rental_bookings b JOIN listings l ON l.id = b.listing_id WHERE b.id = ${b.id}::uuid
  `);
  const km = geo[0]?.km ?? null;

  const events = await conn
    .select()
    .from(rentalBookingEvents)
    .where(eq(rentalBookingEvents.bookingId, b.id))
    .orderBy(asc(rentalBookingEvents.createdAt), asc(rentalBookingEvents.id));
  const [dispute] = await conn
    .select({ id: dealDisputes.id, status: dealDisputes.status, outcome: dealDisputes.outcome })
    .from(dealDisputes)
    .where(eq(dealDisputes.rentalBookingId, b.id))
    .orderBy(desc(dealDisputes.createdAt))
    .limit(1);
  const settings = await getSettings(conn);
  const thumbs = await thumbOf(conn, [b.listingId]);

  const view: RentalBookingView = {
    id: b.id,
    ref: b.ref,
    side: reader.side,
    role: reader.memberRole,
    status: b.status,
    turn: b.turn,
    listing: { id: b.listingId, title: publicText(b.listingTitle) ?? '', thumbUrl: thumbs.get(b.listingId) ?? null, kind: 'machine_rental' },
    counterpart: {
      businessId: counterpartId,
      tradeName: publicText(cp?.name ?? '') ?? '',
      verified: cp?.levels.includes('gst') ?? false,
      city: cp?.city ?? null,
    },
    current,
    versions,
    changeCount: b.changeCount,
    changesLeft: Math.max(0, settings.rental_max_changes - b.changeCount),
    replyDueAt: iso(b.replyDueAt),
    agreedTotalPaise: b.agreedTotalPaise === null ? null : Number(b.agreedTotalPaise),
    finalAmountPaise: b.finalAmountPaise === null ? null : Number(b.finalAmountPaise),
    finalAmountReason: b.finalAmountReason,
    finalAmountNote: visibleText(b.finalAmountNote, chat, thread),
    terms: b.termsSnapshot,
    site: {
      pincode: b.sitePincode,
      city: b.siteCity,
      state: b.siteState,
      address: siteAddressFor(b, reader, thread),
      distanceKm: reader.side === 'owner' && km !== null ? Number(km) : null,
      beyondServiceRadius: geo[0]?.beyond ?? null,
    },
    onSite: b.onSiteAt
      ? {
          at: b.onSiteAt.toISOString(),
          bySide: b.onSiteBySide === 'renter' ? 'renter' : 'owner',
          hourMeter: b.hourMeterStart,
          photoCount: b.onSitePhotoKeys.length,
        }
      : null,
    returned: b.returnedAt
      ? {
          at: b.returnedAt.toISOString(),
          hourMeter: b.hourMeterEnd,
          damageNote: visibleText(b.damageNote, chat, thread),
          photoCount: b.returnPhotoKeys.length,
        }
      : null,
    autoCompleteAt: iso(b.autoCompleteAt),
    completedAt: iso(b.completedAt),
    completedHow: b.completedHow,
    cancelled:
      b.status === 'cancelled' && b.cancelledAt
        ? {
            at: b.cancelledAt.toISOString(),
            bySide: b.cancelledBySide ?? 'system',
            reason: b.cancelReason,
            note: visibleText(b.cancelNote, chat, thread),
          }
        : null,
    declineReason: b.declineReason,
    notes: {
      paymentMethod: b.paymentMethod,
      advancePaise: b.advancePaise === null ? null : Number(b.advancePaise),
      depositPaise: b.depositPaise === null ? null : Number(b.depositPaise),
      depositReturned: b.depositReturned,
      expectedOnSiteTime: b.expectedOnSiteTime,
      text: visibleText(b.notesText, chat, thread),
      textFlagged: b.notesScamFlag,
      updatedAt: iso(b.notesUpdatedAt),
      version: b.version,
    },
    timeline: events.map((e) => ({ code: e.code, actorSide: e.actorSide, at: e.createdAt.toISOString(), values: e.values })),
    contact: await contactState(conn, thread, chat),
    review: b.status === 'completed' ? await getRentalReviewState(conn, { userId: reader.userId, businessId: reader.businessId }, b.id) : null,
    dispute: dispute ? { id: dispute.id, status: dispute.status, outcome: dispute.outcome } : null,
    threadId: b.threadId,
    clashWith: await clashWithFor(conn, b.id),
    actions: [],
  };
  view.actions = rentalBookingActions(view, today);
  return view;
}

/** Rows of the Deals tab's Rentals list for `businessId` (names and titles masked; `yourTurn` per §6.6). */
export async function toBookingListRows(conn: Conn, rows: RentalBookingRow[], businessId: string, today: string): Promise<RentalBookingListRow[]> {
  if (rows.length === 0) return [];
  const otherIds = rows.map((b) => (b.renterBusinessId === businessId ? b.ownerBusinessId : b.renterBusinessId));
  const names = await conn
    .select({ id: businesses.id, name: businesses.tradeName })
    .from(businesses)
    .where(inArray(businesses.id, [...new Set(otherIds)]));
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const versionIds = rows.flatMap((b) => (b.currentVersionId ? [b.currentVersionId] : []));
  const totals = versionIds.length
    ? await conn
        .select({ id: rentalBookingVersions.id, total: rentalBookingVersions.totalPaise })
        .from(rentalBookingVersions)
        .where(inArray(rentalBookingVersions.id, versionIds))
    : [];
  const totalOf = new Map(totals.map((t) => [t.id, Number(t.total)]));
  const thumbs = await thumbOf(conn, rows.map((b) => b.listingId));
  return rows.map((b, i) => {
    const side: BookingSide = b.renterBusinessId === businessId ? 'renter' : 'owner';
    return {
      id: b.id,
      ref: b.ref,
      side,
      status: b.status,
      yourTurn: rentalYourTurn(b, side, today),
      listingTitle: publicText(b.listingTitle) ?? '',
      thumbUrl: thumbs.get(b.listingId) ?? null,
      counterpartName: publicText(nameOf.get(otherIds[i]!) ?? '') ?? '',
      startDate: b.startDate,
      endDate: b.endDate,
      machines: b.machines,
      totalPaise: b.agreedTotalPaise !== null ? Number(b.agreedTotalPaise) : (b.currentVersionId ? (totalOf.get(b.currentVersionId) ?? null) : null),
      updatedAt: b.updatedAt.toISOString(),
    };
  });
}

/** The thread's booking cards for a reader (`ThreadMessage.booking`), batch-loaded; bookings of another thread skipped. */
export async function bookingCardViews(
  conn: Conn,
  bookingIds: string[],
  reader: Pick<ChatReader, 'memberRole'>,
  thread: ThreadRow,
): Promise<Map<string, RentalBookingCardView>> {
  const ids = [...new Set(bookingIds)];
  if (ids.length === 0) return new Map();
  const rows = await conn.select().from(rentalBookings).where(inArray(rentalBookings.id, ids));
  const own = rows.filter((b) => b.threadId === thread.id);
  const versionIds = own.flatMap((b) => (b.currentVersionId ? [b.currentVersionId] : []));
  const versions = versionIds.length ? await conn.select().from(rentalBookingVersions).where(inArray(rentalBookingVersions.id, versionIds)) : [];
  const versionOf = new Map(versions.map((v) => [v.id, v]));
  const out = new Map<string, RentalBookingCardView>();
  for (const b of own) {
    const v = b.currentVersionId ? versionOf.get(b.currentVersionId) : undefined;
    if (!v) continue;
    out.set(b.id, {
      id: b.id,
      ref: b.ref,
      status: b.status,
      turn: b.turn,
      current: toVersionView(v, reader, thread),
      listingTitle: publicText(b.listingTitle) ?? '',
    });
  }
  return out;
}
