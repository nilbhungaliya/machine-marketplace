import { eq, sql } from 'drizzle-orm';
import { PART_REQUEST_LIMITS, type PartRequestHome } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { partRequests } from '../../db/schema.js';
import { maskContact } from '../../lib/mask-contact.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { snappedKmBetweenSql } from '../discovery/distance.js';
import { notBlockedSql } from './buyer-view.js';
import { requestsForYouCount } from './request-counts.js';
import { listForSellers } from './seller-read.service.js';

// `GET /part-requests/home` (spec §12.2, §13.2, review Q6; plan A1-3, D17): the buyer side-match strip and the seller
// "Buyers looking for your parts" strip.

type Conn = Db | Tx;

/**
 * The buyer strip: among the business's active requests, the one with the most recent unseen item (tie: the newest
 * request). Items are auto matches not yet seen and delivered replies not yet viewed, created after the request's
 * `buyer_seen_at` (sellers blocked either way left out). `nearestKm` is the nearest of those items (snapped km: the
 * stored match distance, a reply's listing from the request's point). Null when there is nothing new.
 */
async function buyerStrip(conn: Conn, businessId: string): Promise<PartRequestHome['buyer']> {
  const replyKm = snappedKmBetweenSql(sql`COALESCE(l.search_point, l.point)`, sql`r.point`);
  const { rows } = await conn.execute<{ rid: string; n: number; nearest: number | null }>(sql`
    WITH items AS (
      SELECT m.part_request_id AS rid, m.created_at AS at, m.distance_km AS km
        FROM part_request_matches m
        JOIN part_requests r ON r.id = m.part_request_id
       WHERE r.business_id = ${businessId} AND r.status = 'active' AND m.seen_at IS NULL
         AND (r.buyer_seen_at IS NULL OR m.created_at > r.buyer_seen_at)
         AND ${notBlockedSql(sql`m.seller_business_id`, sql`r.business_id`)}
      UNION ALL
      SELECT rr.part_request_id, COALESCE(rr.delivered_at, rr.created_at), ${replyKm}
        FROM part_request_replies rr
        JOIN part_requests r ON r.id = rr.part_request_id
        JOIN listings l ON l.id = rr.listing_id
       WHERE r.business_id = ${businessId} AND r.status = 'active' AND rr.status = 'delivered' AND rr.buyer_viewed_at IS NULL
         AND (r.buyer_seen_at IS NULL OR COALESCE(rr.delivered_at, rr.created_at) > r.buyer_seen_at)
         AND ${notBlockedSql(sql`rr.seller_business_id`, sql`r.business_id`)}
    )
    SELECT i.rid, count(*)::int AS n, min(i.km)::int AS nearest
      FROM items i JOIN part_requests r ON r.id = i.rid
     GROUP BY i.rid, r.created_at
     ORDER BY max(i.at) DESC, r.created_at DESC, i.rid DESC
     LIMIT 1`);
  const top = rows[0];
  if (!top) return null;
  const [r] = await conn.select({ name: partRequests.name, side: partRequests.side }).from(partRequests).where(eq(partRequests.id, top.rid));
  if (!r) return null;
  return {
    partRequestId: top.rid,
    name: maskContact(r.name),
    side: r.side,
    newCount: Number(top.n),
    nearestKm: top.nearest === null ? null : Number(top.nearest),
  };
}

/** D17: a business with the `sell` activity or a live listing gets the seller strip. */
async function sells(conn: Conn, businessId: string): Promise<boolean> {
  const { rows } = await conn.execute<{ ok: boolean }>(sql`
    SELECT ('sell' = ANY(b.activities) OR EXISTS (SELECT 1 FROM listings l WHERE l.business_id = b.id AND l.status = 'live')) AS ok
      FROM businesses b WHERE b.id = ${businessId}`);
  return rows[0]?.ok === true;
}

/** Both strips for the user's business; both null without one. */
export async function partRequestHome(conn: Conn, user: UserTokenPayload): Promise<PartRequestHome> {
  const businessId = user.businessId;
  if (!businessId) return { buyer: null, seller: null };
  const buyer = await buyerStrip(conn, businessId);
  let seller: PartRequestHome['seller'] = null;
  if (await sells(conn, businessId)) {
    const page = await listForSellers(conn, user, { tab: 'matched' });
    seller = { newCount: await requestsForYouCount(conn, user), items: page.items.slice(0, PART_REQUEST_LIMITS.homeSellerItems) };
  }
  return { buyer, seller };
}
