import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { PART_REQUEST_LIMITS, type CompareColumn, type ListingCard } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings, partRequestMatches, partRequestReplies } from '../../db/schema.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { snappedKmBetweenSql } from '../discovery/distance.js';
import { loadCards } from '../listings/listing-view.service.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import { notBlockedSql } from './buyer-view.js';
import { ownRequest, sellerInfos } from './request-read.service.js';

// Compare (spec §12.2, R10; plan A1-3; textile compare in `requirement.service.ts`): the buyer's public replies, then
// its auto matches, deduped by listing, at most `compareMax` columns: price per unit or "on request", available
// quantity, side, condition, snapped km from the request's point, rating or "New seller", verified, and the action the
// listing page opens with.

type Conn = Db | Tx;

/** Fixed → buy, negotiable → offer, on request → ask price, anything else → enquire. */
function contactAction(card: ListingCard): CompareColumn['contactAction'] {
  if (card.priceModel === 'fixed') return 'buy';
  if (card.priceModel === 'negotiable') return 'offer';
  if (card.priceModel === 'on_request') return 'ask_price';
  return 'enquire';
}

/** `GET /part-requests/:id/compare` (buyer only, else 404). */
export async function compareColumns(conn: Conn, user: UserTokenPayload, id: string): Promise<{ columns: CompareColumn[] }> {
  const row = await ownRequest(conn, user, id);
  const publicL = publicListingWhere(listings);
  const replyRows = await conn
    .select({ listingId: partRequestReplies.listingId })
    .from(partRequestReplies)
    .innerJoin(listings, eq(listings.id, partRequestReplies.listingId))
    .where(
      and(
        eq(partRequestReplies.partRequestId, row.id),
        eq(partRequestReplies.status, 'delivered'),
        publicL,
        notBlockedSql(sql`${partRequestReplies.sellerBusinessId}`, sql`${row.businessId}::uuid`),
      ),
    )
    .orderBy(desc(partRequestReplies.deliveredAt), desc(partRequestReplies.id));
  const matchRows = await conn
    .select({ listingId: partRequestMatches.listingId })
    .from(partRequestMatches)
    .innerJoin(listings, eq(listings.id, partRequestMatches.listingId))
    .where(
      and(
        eq(partRequestMatches.partRequestId, row.id),
        publicL,
        notBlockedSql(sql`${partRequestMatches.sellerBusinessId}`, sql`${row.businessId}::uuid`),
      ),
    )
    .orderBy(desc(partRequestMatches.createdAt), desc(partRequestMatches.listingId));

  const picked: Array<{ listingId: string; source: CompareColumn['source'] }> = [];
  const seen = new Set<string>();
  for (const [source, rows] of [['reply', replyRows], ['match', matchRows]] as const) {
    for (const r of rows) {
      if (seen.has(r.listingId) || picked.length >= PART_REQUEST_LIMITS.compareMax) continue;
      seen.add(r.listingId);
      picked.push({ listingId: r.listingId, source });
    }
  }
  if (picked.length === 0) return { columns: [] };

  const ids = picked.map((p) => p.listingId);
  const listingRows = await conn.select().from(listings).where(inArray(listings.id, ids));
  const byId = new Map(listingRows.map((l) => [l.id, l]));
  const ordered = ids.map((lid) => byId.get(lid)!).filter(Boolean);
  const cards = new Map((await loadCards(conn, ordered)).map((c) => [c.id, c]));
  const distances = new Map(
    (
      await conn
        .select({
          id: listings.id,
          km: snappedKmBetweenSql(sql`COALESCE(${listings.searchPoint}, ${listings.point})`, sql`(SELECT p.point FROM part_requests p WHERE p.id = ${row.id})`),
        })
        .from(listings)
        .where(inArray(listings.id, ids))
    ).map((d) => [d.id, d.km === null ? null : Number(d.km)]),
  );
  const sellers = await sellerInfos(conn, ordered.map((l) => l.businessId));

  const priced = (c: ListingCard) => (c.priceModel === 'fixed' || c.priceModel === 'negotiable') && c.pricePaise !== null;
  const prices = [...cards.values()].filter(priced).map((c) => c.pricePaise!);
  const lowest = prices.length ? Math.min(...prices) : null;

  const columns: CompareColumn[] = [];
  for (const p of picked) {
    const card = cards.get(p.listingId);
    const listing = byId.get(p.listingId);
    if (!card || !listing) continue;
    const seller = sellers.get(listing.businessId);
    columns.push({
      listingId: p.listingId,
      source: p.source,
      title: card.title,
      pricePerUnitPaise: card.priceModel === 'on_request' ? null : card.pricePaise,
      priceOnRequest: card.priceModel === 'on_request',
      availableQuantity: card.availableQuantity,
      unitLabel: card.unit?.label ?? null,
      side: card.side,
      conditionLabel: card.condition?.label ?? null,
      distanceKm: distances.get(p.listingId) ?? null,
      rating: seller?.score?.stars ?? null,
      reviewCount: seller?.score?.count ?? 0,
      verified: seller?.verified ?? false,
      lowestPrice: lowest !== null && priced(card) && card.pricePaise === lowest,
      contactAction: contactAction(card),
    });
  }
  return { columns };
}
