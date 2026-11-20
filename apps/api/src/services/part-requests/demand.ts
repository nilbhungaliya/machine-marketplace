import { eq, sql } from 'drizzle-orm';
import { PART_REQUEST_LIMITS, type PartRequestDemand } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { listingNotFound, type ListingRow } from '../listings/locks.js';
import { categoryAncestorIds } from './categories.js';
import { eligibleSellerSql } from './eligibility.js';
import { matchRuleSql, requestCandidateSql } from './match-rule.js';

// "Buyers are looking for this" on the seller's listing (spec §12.2, §12.3, `GET /listings/:id/part-request-demand`;
// plan A2-3): the active requests the §7.4 rule would match for this listing — in any listing status (a draft or a
// listing in review counts, `requireLive: false`) — and that the seller is eligible for (§6).

type Conn = Db | Tx;

const L = sql.raw('l');
const PR = sql.raw('part_requests');

/** Every matching request id, newest first (`eligibleSellerSql` reads the unaliased `part_requests` row). */
async function demandIds(conn: Conn, listing: ListingRow, sellerBusinessId: string): Promise<string[]> {
  if ((listing.kind !== 'part' && listing.kind !== 'machine') || !listing.categoryId) return [];
  const ancestors = await categoryAncestorIds(conn, listing.categoryId);
  if (ancestors.length === 0) return [];
  const { rows } = await conn.execute<{ id: string }>(sql`
    SELECT part_requests.id FROM part_requests
    JOIN listings l ON l.id = ${listing.id}::uuid
    WHERE ${requestCandidateSql(PR, listing.kind, ancestors)}
      AND ${matchRuleSql(L, PR, { requireLive: false })}
      AND ${eligibleSellerSql(sellerBusinessId)}
    ORDER BY part_requests.created_at DESC, part_requests.id DESC`);
  return rows.map((r) => r.id);
}

/** Ids of active requests the seller is eligible for that the listing could answer (at most `demandIdsMax`). */
export async function demandRequestIds(conn: Conn, listingId: string, sellerBusinessId: string): Promise<string[]> {
  const [listing] = await conn.select().from(listings).where(eq(listings.id, listingId));
  if (!listing || listing.businessId !== sellerBusinessId) return [];
  return (await demandIds(conn, listing, sellerBusinessId)).slice(0, PART_REQUEST_LIMITS.demandIdsMax);
}

/** `GET /listings/:id/part-request-demand` (owner only, else `404 LISTING_NOT_FOUND`): the count and up to 10 ids. */
export async function listingDemand(conn: Conn, user: UserTokenPayload, listingId: string): Promise<PartRequestDemand> {
  const [listing] = await conn.select().from(listings).where(eq(listings.id, listingId));
  if (!listing || !user.businessId || listing.businessId !== user.businessId) throw listingNotFound();
  const ids = await demandIds(conn, listing, user.businessId);
  return { count: ids.length, partRequestIds: ids.slice(0, PART_REQUEST_LIMITS.demandIdsMax) };
}
