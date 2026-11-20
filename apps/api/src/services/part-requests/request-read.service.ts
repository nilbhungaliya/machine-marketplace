import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  PART_REQUEST_LIMITS,
  isMatched,
  partRequestDaysLeft,
  type MyPartRequestTab,
  type MyPartRequestsPage,
  type PartRequestMatchItem,
  type PartRequestReplyItem,
  type PartRequestStatus,
  type PartRequestView,
  type SellerScore,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, listings, partRequestMatches, partRequestReplies, partRequests, units } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { maskContact } from '../../lib/mask-contact.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { businessDisplayName } from '../business/profile.service.js';
import { openCursor, sealCursor } from '../discovery/cursor.js';
import { loadCards, trimQuantity } from '../listings/listing-view.service.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import { sellerScore } from '../reviews/review-scores.js';
import { buyerView, fitLine, loadFitViews, notBlockedSql } from './buyer-view.js';
import { requestRoleFor } from './eligibility.js';
import { partRequestNotFound, type PartRequestRow } from './locks.js';
import { sellerView } from './seller-view.js';

// Buyer reads (spec §12.2; plan A1-3; textile `services/requirements/{requirement-view,reply-view}.ts`): My
// requirements, the request page (buyer or seller by `role`, plan D3), its delivered replies and auto matches. Replies
// and matches of a seller blocked either way are left out; listing cards are the public ones.

type Conn = Db | Tx;
const PAGE = PART_REQUEST_LIMITS.listingsPageSize;
const invalidCursor = () => new ValidationError('Invalid cursor', undefined, 'INVALID_CURSOR');

/** The request when it is the user's business's (unlocked); anyone else `404 PART_REQUEST_NOT_FOUND`. */
export async function ownRequest(conn: Conn, user: UserTokenPayload, id: string): Promise<PartRequestRow> {
  if (!user.businessId) throw partRequestNotFound();
  const [row] = await conn.select().from(partRequests).where(eq(partRequests.id, id));
  if (!row || row.businessId !== user.businessId) throw partRequestNotFound();
  return row;
}

/** `GET /part-requests/:id` (plan D3): the buyer view for its own business, the seller view when eligible, else 404. */
export async function getPartRequestView(conn: Conn, user: UserTokenPayload, id: string): Promise<PartRequestView> {
  if (!user.businessId) throw partRequestNotFound();
  const role = await requestRoleFor(conn, id, user.businessId);
  if (!role) throw partRequestNotFound();
  const [row] = await conn.select().from(partRequests).where(eq(partRequests.id, id));
  if (!row) throw partRequestNotFound();
  return role === 'buyer' ? buyerView(conn, row) : sellerView(conn, user, row);
}

// ─── My requirements (plan D15) ───

const TAB_STATUSES: Record<MyPartRequestTab, PartRequestStatus[]> = {
  active: ['active'],
  fulfilled: ['fulfilled'],
  closed: ['closed', 'expired', 'removed'],
};

interface MineCursor {
  at: string;
  id: string;
}

const createdAtText = sql<string>`to_char(${partRequests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/** `GET /part-requests/mine?status=&cursor=`: the business's requests, newest first, 20 a page; counts per tab. */
export async function listMyPartRequests(
  conn: Conn,
  user: UserTokenPayload,
  q: { status: MyPartRequestTab; cursor?: string },
): Promise<MyPartRequestsPage> {
  const businessId = user.businessId;
  if (!businessId) return { items: [], nextCursor: null, counts: { active: 0, fulfilled: 0, closed: 0 } };
  const aad = `part-requests:mine:${user.userId}:${q.status}`;
  const where: SQL[] = [eq(partRequests.businessId, businessId), inArray(partRequests.status, TAB_STATUSES[q.status])];
  if (q.cursor) {
    let c: MineCursor;
    try {
      c = openCursor<MineCursor>(q.cursor, aad);
    } catch {
      throw invalidCursor();
    }
    if (typeof c.at !== 'string' || typeof c.id !== 'string') throw invalidCursor();
    where.push(sql`(${partRequests.createdAt}, ${partRequests.id}) < ((${c.at}::timestamp AT TIME ZONE 'UTC'), ${c.id}::uuid)`);
  }
  const notBlockedReply = notBlockedSql(sql`rr.seller_business_id`, sql`${partRequests.businessId}`);
  const notBlockedMatch = notBlockedSql(sql`m.seller_business_id`, sql`${partRequests.businessId}`);
  const rows = await conn
    .select({
      r: partRequests,
      at: createdAtText,
      unitLabel: units.label,
      replies: sql<number>`(SELECT count(*)::int FROM part_request_replies rr
        WHERE rr.part_request_id = ${partRequests.id} AND rr.status = 'delivered' AND ${notBlockedReply})`,
      newReplies: sql<number>`(SELECT count(*)::int FROM part_request_replies rr
        WHERE rr.part_request_id = ${partRequests.id} AND rr.status = 'delivered' AND rr.buyer_viewed_at IS NULL AND ${notBlockedReply})`,
      matches: sql<number>`(SELECT count(*)::int FROM part_request_matches m
        WHERE m.part_request_id = ${partRequests.id} AND ${notBlockedMatch})`,
      newMatches: sql<number>`(SELECT count(*)::int FROM part_request_matches m
        WHERE m.part_request_id = ${partRequests.id} AND m.seen_at IS NULL AND ${notBlockedMatch})`,
    })
    .from(partRequests)
    .innerJoin(units, eq(units.id, partRequests.unitId))
    .where(and(...where))
    .orderBy(desc(partRequests.createdAt), desc(partRequests.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const last = page[page.length - 1];
  const nextCursor = rows.length > PAGE && last ? sealCursor({ at: last.at, id: last.r.id }, aad) : null;

  const [c] = await conn
    .select({
      active: sql<number>`count(*) FILTER (WHERE ${partRequests.status} = 'active')::int`,
      fulfilled: sql<number>`count(*) FILTER (WHERE ${partRequests.status} = 'fulfilled')::int`,
      closed: sql<number>`count(*) FILTER (WHERE ${inArray(partRequests.status, TAB_STATUSES.closed)})::int`,
    })
    .from(partRequests)
    .where(eq(partRequests.businessId, businessId));

  const fits = await loadFitViews(conn, page.map((x) => x.r.id));
  const now = new Date();
  return {
    items: page.map((x) => {
      const replies = Number(x.replies);
      const matches = Number(x.matches);
      return {
        id: x.r.id,
        name: maskContact(x.r.name),
        kind: x.r.kind,
        side: x.r.side,
        quantity: trimQuantity(x.r.quantity) ?? x.r.quantity,
        unitLabel: x.unitLabel,
        firstFit: fitLine(fits.get(x.r.id)?.[0]),
        status: x.r.status,
        matched: isMatched({ deliveredReplyCount: replies, matchCount: matches }),
        replyCount: replies,
        matchCount: matches,
        newCount: Number(x.newReplies) + Number(x.newMatches),
        daysLeft: partRequestDaysLeft(x.r.expiresAt, now),
        createdAt: x.r.createdAt.toISOString(),
      };
    }),
    nextCursor,
    counts: { active: Number(c?.active ?? 0), fulfilled: Number(c?.fulfilled ?? 0), closed: Number(c?.closed ?? 0) },
  };
}

// ─── Sellers of replies and matches ───

export interface SellerInfo {
  businessId: string;
  name: string;
  verified: boolean;
  score: SellerScore | null;
}

/** Display name (masked), GST badge and score of each seller business. */
export async function sellerInfos(conn: Conn, businessIds: string[]): Promise<Map<string, SellerInfo>> {
  const out = new Map<string, SellerInfo>();
  const ids = [...new Set(businessIds)];
  if (ids.length === 0) return out;
  const rows = await conn
    .select({
      id: businesses.id,
      tradeName: businesses.tradeName,
      legalName: businesses.legalName,
      verified: sql<boolean>`(${businesses.verificationLevels} ? 'gst')`,
    })
    .from(businesses)
    .where(inArray(businesses.id, ids));
  for (const b of rows) {
    out.set(b.id, {
      businessId: b.id,
      name: maskContact(await businessDisplayName(conn, b)),
      verified: b.verified === true,
      score: await sellerScore(conn, b.id),
    });
  }
  return out;
}

const publicListing = publicListingWhere(listings);

// ─── Replies (§12.2) ───

/**
 * `GET /part-requests/:id/replies` (buyer business only, else 404): delivered replies (withdrawn, pending and dropped
 * ones never), sellers blocked either way left out; public listings first, then newest delivery. Messages masked.
 */
export async function listReplies(conn: Conn, user: UserTokenPayload, id: string): Promise<{ items: PartRequestReplyItem[] }> {
  const row = await ownRequest(conn, user, id);
  const rows = await conn
    .select({ reply: partRequestReplies, l: listings, live: sql<boolean>`${publicListing}` })
    .from(partRequestReplies)
    .innerJoin(listings, eq(listings.id, partRequestReplies.listingId))
    .where(
      and(
        eq(partRequestReplies.partRequestId, row.id),
        eq(partRequestReplies.status, 'delivered'),
        notBlockedSql(sql`${partRequestReplies.sellerBusinessId}`, sql`${row.businessId}::uuid`),
      ),
    )
    .orderBy(desc(sql`${publicListing}`), desc(partRequestReplies.deliveredAt), desc(partRequestReplies.id));
  const cards = await loadCards(conn, rows.map((x) => x.l), { viewerUserId: user.userId, viewerBusinessId: row.businessId });
  const sellers = await sellerInfos(conn, rows.map((x) => x.reply.sellerBusinessId));
  return {
    items: rows.map((x, i) => {
      const s = sellers.get(x.reply.sellerBusinessId)!;
      return {
        replyId: x.reply.id,
        card: cards[i]!,
        seller: { businessId: s.businessId, name: s.name, verified: s.verified, score: s.score },
        message: x.reply.message === null ? null : maskContact(x.reply.message),
        messageFlagged: x.reply.messageFlagged,
        live: x.live === true,
        deliveredAt: (x.reply.deliveredAt ?? x.reply.createdAt).toISOString(),
        viewed: x.reply.buyerViewedAt !== null,
      };
    }),
  };
}

// ─── Matches (§12.2) ───

/** `GET /part-requests/:id/matches` (buyer only): auto matches, sellers blocked either way left out; public first, newest. */
export async function listMatches(conn: Conn, user: UserTokenPayload, id: string): Promise<{ items: PartRequestMatchItem[] }> {
  const row = await ownRequest(conn, user, id);
  const rows = await conn
    .select({ m: partRequestMatches, l: listings })
    .from(partRequestMatches)
    .innerJoin(listings, eq(listings.id, partRequestMatches.listingId))
    .where(
      and(
        eq(partRequestMatches.partRequestId, row.id),
        notBlockedSql(sql`${partRequestMatches.sellerBusinessId}`, sql`${row.businessId}::uuid`),
      ),
    )
    .orderBy(desc(sql`${publicListing}`), desc(partRequestMatches.createdAt), desc(partRequestMatches.listingId));
  const cards = await loadCards(conn, rows.map((x) => x.l), { viewerUserId: user.userId, viewerBusinessId: row.businessId });
  return {
    items: rows.map((x, i) => ({
      listingId: x.m.listingId,
      card: cards[i]!,
      tier: x.m.tier,
      distanceKm: x.m.distanceKm,
      seen: x.m.seenAt !== null,
      createdAt: x.m.createdAt.toISOString(),
    })),
  };
}
