import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  AdminRentalBookingDetail,
  AdminRentalBookingRow,
  RentalBlockView,
  RentalVersionView,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import {
  adminUsers,
  businesses,
  dealDisputes,
  dealReviews,
  listingMedia,
  rentalBlocks,
  rentalBookingEvents,
  rentalBookingVersions,
  rentalBookings,
} from '../../db/schema.js';
import { maskContact } from '../../lib/mask-contact.js';
import { publicUrl } from '../../lib/media-url.js';
import { privatePhotoUrl } from '../chat/private-photo.js';
import { getSettings } from '../settings.service.js';
import { clashWithFor } from './capacity.js';
import type { RentalBookingRow } from './locks.js';

/**
 * Admin views of rental bookings (M14 spec §15, R15; plan A3-4): list rows (also the listing detail's bookings block)
 * and the detail. Staff read the site address as stored (my call 11); every other text a party typed — version
 * messages, notes, the damage, final-amount and cancel notes — leaves masked (§8, §18), as for the parties.
 */

type Conn = Db | Tx;

const renterBiz = alias(businesses, 'renter_biz');
const ownerBiz = alias(businesses, 'owner_biz');

const masked = (text: string | null): string | null => (text === null ? null : maskContact(text));
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The list row's columns (`rental_bookings` with both businesses' names). */
export function adminRowsQuery(conn: Conn) {
  return conn
    .select({ b: rentalBookings, renterName: renterBiz.tradeName, ownerName: ownerBiz.tradeName })
    .from(rentalBookings)
    .innerJoin(renterBiz, eq(renterBiz.id, rentalBookings.renterBusinessId))
    .innerJoin(ownerBiz, eq(ownerBiz.id, rentalBookings.ownerBusinessId));
}

export { renterBiz, ownerBiz };

export function toAdminRentalRow(r: { b: RentalBookingRow; renterName: string; ownerName: string }): AdminRentalBookingRow {
  const b = r.b;
  return {
    id: b.id,
    ref: b.ref,
    listing: { id: b.listingId, title: b.listingTitle },
    renter: { businessId: b.renterBusinessId, name: r.renterName },
    owner: { businessId: b.ownerBusinessId, name: r.ownerName },
    startDate: b.startDate,
    endDate: b.endDate,
    machines: b.machines,
    status: b.status,
    agreedTotalPaise: b.agreedTotalPaise,
    updatedAt: b.updatedAt.toISOString(),
  };
}

export function toBlockView(row: typeof rentalBlocks.$inferSelect): RentalBlockView {
  return { id: row.id, startDate: row.startDate, endDate: row.endDate, machines: row.machines, reason: row.reason, note: row.note };
}

/** `AdminListingDetail.rental` (§15): a rental listing's bookings (newest first, ≤ 100) and its owner blocks. */
export async function adminListingRental(
  conn: Conn,
  listingId: string,
): Promise<{ bookings: AdminRentalBookingRow[]; blocks: RentalBlockView[] }> {
  const rows = await adminRowsQuery(conn)
    .where(eq(rentalBookings.listingId, listingId))
    .orderBy(desc(rentalBookings.startDate), desc(rentalBookings.ref))
    .limit(100);
  const blocks = await conn
    .select()
    .from(rentalBlocks)
    .where(eq(rentalBlocks.listingId, listingId))
    .orderBy(asc(rentalBlocks.startDate), asc(rentalBlocks.id));
  return { bookings: rows.map(toAdminRentalRow), blocks: blocks.map(toBlockView) };
}

function toVersionView(v: typeof rentalBookingVersions.$inferSelect): RentalVersionView {
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
    estimatePaise: v.estimatePaise,
    totalPaise: v.totalPaise,
    message: masked(v.message),
    messageFlagged: v.messageScamFlag,
    createdAt: v.createdAt.toISOString(),
  };
}

async function signedUrls(keys: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const key of keys) {
    try {
      out.push((await privatePhotoUrl(key)).url);
    } catch {
      // Storage unavailable: the detail still loads without the photo.
    }
  }
  return out;
}

/** The site's distance from the machine's base, whole km (floored), and whether it is past the service radius. */
async function siteDistance(conn: Conn, b: RentalBookingRow): Promise<{ km: number | null; beyond: boolean | null }> {
  const { rows } = await conn.execute<{ km: number | null }>(sql`
    SELECT floor(ST_Distance(b.site_point, l.point) / 1000)::int AS km
    FROM rental_bookings b JOIN listings l ON l.id = b.listing_id
    WHERE b.id = ${b.id}::uuid AND b.site_point IS NOT NULL AND l.point IS NOT NULL`);
  const km = rows[0]?.km ?? null;
  const radius = b.termsSnapshot.serviceRadiusKm ?? null;
  return { km: km === null ? null : Number(km), beyond: km === null || radius === null ? null : Number(km) > radius };
}

/**
 * `GET /admin/rental-bookings/:id` (§15): the terms snapshot, every version, the agreed / final money, the site (address
 * as stored), on-site and return facts with hour meters, notes, the timeline with admin names, the photos as 300 s
 * signed URLs, the latest dispute, the reviews' state and a clash with a booking still out.
 */
export async function buildAdminRentalDetail(conn: Conn, b: RentalBookingRow): Promise<AdminRentalBookingDetail> {
  const [names] = await conn
    .select({ renterName: renterBiz.tradeName, ownerName: ownerBiz.tradeName })
    .from(renterBiz)
    .innerJoin(ownerBiz, eq(ownerBiz.id, b.ownerBusinessId))
    .where(eq(renterBiz.id, b.renterBusinessId));
  const versions = (
    await conn.select().from(rentalBookingVersions).where(eq(rentalBookingVersions.bookingId, b.id)).orderBy(asc(rentalBookingVersions.seq))
  ).map((v) => ({ id: v.id, view: toVersionView(v) }));
  const current = versions.find((v) => v.id === b.currentVersionId) ?? versions[versions.length - 1];
  const events = await conn
    .select({ e: rentalBookingEvents, adminName: adminUsers.name })
    .from(rentalBookingEvents)
    .leftJoin(adminUsers, eq(adminUsers.id, rentalBookingEvents.actorAdminId))
    .where(eq(rentalBookingEvents.bookingId, b.id))
    .orderBy(asc(rentalBookingEvents.createdAt), asc(rentalBookingEvents.id));
  const [thumb] = await conn
    .select({ thumbKey: listingMedia.thumbKey })
    .from(listingMedia)
    .where(and(eq(listingMedia.listingId, b.listingId), eq(listingMedia.type, 'photo')))
    .orderBy(asc(listingMedia.sortOrder), asc(listingMedia.createdAt))
    .limit(1);
  const [dispute] = await conn
    .select({ id: dealDisputes.id, status: dealDisputes.status, outcome: dealDisputes.outcome })
    .from(dealDisputes)
    .where(eq(dealDisputes.rentalBookingId, b.id))
    .orderBy(sql`(${dealDisputes.status} = 'open') DESC`, desc(dealDisputes.createdAt))
    .limit(1);
  const reviews = await conn
    .select({ side: dealReviews.reviewerSide, publishedAt: dealReviews.publishedAt })
    .from(dealReviews)
    .where(eq(dealReviews.rentalBookingId, b.id));
  const { rental_max_changes: maxChanges } = await getSettings(conn);
  const distance = await siteDistance(conn, b);

  return {
    id: b.id,
    ref: b.ref,
    status: b.status,
    turn: b.turn,
    listing: { id: b.listingId, title: b.listingTitle, thumbUrl: thumb ? publicUrl(thumb.thumbKey) : null, kind: 'machine_rental' },
    renter: { businessId: b.renterBusinessId, name: names?.renterName ?? '' },
    owner: { businessId: b.ownerBusinessId, name: names?.ownerName ?? '' },
    current: current!.view,
    versions: versions.map((v) => v.view),
    changeCount: b.changeCount,
    changesLeft: Math.max(0, maxChanges - b.changeCount),
    replyDueAt: iso(b.replyDueAt),
    agreedTotalPaise: b.agreedTotalPaise,
    finalAmountPaise: b.finalAmountPaise,
    finalAmountReason: b.finalAmountReason,
    finalAmountNote: masked(b.finalAmountNote),
    terms: b.termsSnapshot,
    site: {
      pincode: b.sitePincode,
      city: b.siteCity,
      state: b.siteState,
      address: b.siteAddress,
      distanceKm: distance.km,
      beyondServiceRadius: distance.beyond,
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
      ? { at: b.returnedAt.toISOString(), hourMeter: b.hourMeterEnd, damageNote: masked(b.damageNote), photoCount: b.returnPhotoKeys.length }
      : null,
    autoCompleteAt: iso(b.autoCompleteAt),
    completedAt: iso(b.completedAt),
    completedHow: b.completedHow,
    cancelled: b.cancelledAt
      ? { at: b.cancelledAt.toISOString(), bySide: b.cancelledBySide ?? 'system', reason: b.cancelReason, note: masked(b.cancelNote) }
      : null,
    declineReason: b.declineReason,
    notes: {
      paymentMethod: b.paymentMethod,
      advancePaise: b.advancePaise,
      depositPaise: b.depositPaise,
      depositReturned: b.depositReturned,
      expectedOnSiteTime: b.expectedOnSiteTime,
      text: masked(b.notesText),
      textFlagged: b.notesScamFlag,
      updatedAt: iso(b.notesUpdatedAt),
      version: b.version,
    },
    events: events.map(({ e, adminName }) => ({
      code: e.code,
      actorSide: e.actorSide,
      actorAdminName: adminName ?? null,
      at: e.createdAt.toISOString(),
      values: e.values,
    })),
    photos: { onSite: await signedUrls(b.onSitePhotoKeys), returned: await signedUrls(b.returnPhotoKeys) },
    reviews: {
      renterSubmitted: reviews.some((r) => r.side === 'buyer'),
      ownerSubmitted: reviews.some((r) => r.side === 'seller'),
      published: reviews.some((r) => r.publishedAt !== null),
    },
    dispute: dispute ? { id: dispute.id, status: dispute.status, outcome: dispute.outcome } : null,
    threadId: b.threadId,
    clashWith: await clashWithFor(conn, b.id),
  };
}
