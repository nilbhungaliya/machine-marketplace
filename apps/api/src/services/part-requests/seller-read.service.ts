import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { PART_REQUEST_LIMITS, type PartRequestKind, type SellerPartRequestTab, type SellerPartRequestsPage } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings, partRequests } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { openCursor, sealCursor } from '../discovery/cursor.js';
import { demandRequestIds } from './demand.js';
import { sellerFacts, sellerRows, sellerSelect, type SellerFacts } from './seller-view.js';

// "Buyers looking for your parts" (spec §12.3, plan A1-4, D15, D16): every request the business is eligible for (§6),
// in three tabs. For you (`matched`) = targeted or holding matching stock; All = every eligible active one; Replied =
// any request the business replied to (any status: it follows its reply's outcome). Not relevant hides a request from
// For you and All. Order: targeted (newest notice), then in reach (stock first, newest), then outside the reach.

type Conn = Db | Tx;
const PAGE = PART_REQUEST_LIMITS.listingsPageSize;

interface Cursor {
  g: number;
  at: string;
  id: string;
}

const invalidCursor = () => new ValidationError('Invalid cursor', undefined, 'INVALID_CURSOR');

function tabWhere(f: SellerFacts, tab: SellerPartRequestTab): SQL {
  if (tab === 'replied') return f.replied;
  const active = sql`part_requests.status = 'active' AND NOT ${f.notRelevant}`;
  return tab === 'matched' ? sql`(${active} AND (${f.targeted} OR ${f.hasStock}))` : sql`(${active})`;
}

export interface ForSellersQuery {
  tab: SellerPartRequestTab;
  kind?: PartRequestKind;
  forListing?: string;
  cursor?: string;
}

/**
 * The base filter of a seller list: eligible, the `kind` segment and, with `forListing` (a listing of the reader's
 * business), only the requests `demandRequestIds` returns for it (D16). Null when nothing can match. Every tab needs
 * an active request or one the business replied to, so the base says so too: the tab counts then scan those rows, not
 * every request ever posted.
 */
async function baseWhere(conn: Conn, businessId: string, f: SellerFacts, q: Pick<ForSellersQuery, 'kind' | 'forListing'>): Promise<SQL | null> {
  const where: SQL[] = [
    sql`(part_requests.status = 'active' OR part_requests.id IN (SELECT rb.part_request_id FROM part_request_replies rb
      WHERE rb.seller_business_id = ${businessId}::uuid))`,
    f.eligible,
  ];
  if (q.kind) where.push(eq(partRequests.kind, q.kind));
  if (q.forListing) {
    const [own] = await conn
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.id, q.forListing), eq(listings.businessId, businessId)));
    const ids = own ? await demandRequestIds(conn, own.id, businessId) : [];
    if (ids.length === 0) return null;
    where.push(inArray(partRequests.id, ids));
  }
  return and(...where)!;
}

/** `GET /part-requests/for-sellers?tab=&kind=&forListing=&cursor=` (§12.2): 20 a page by a sealed keyset cursor. */
export async function listForSellers(conn: Conn, user: UserTokenPayload, q: ForSellersQuery): Promise<SellerPartRequestsPage> {
  const empty: SellerPartRequestsPage = { items: [], nextCursor: null, counts: { forYou: 0, all: 0, replied: 0 } };
  const businessId = user.businessId;
  if (!businessId) return empty;
  const f = sellerFacts(businessId);
  const aad = `part-requests:for-sellers:${user.userId}:${q.tab}:${q.kind ?? ''}:${q.forListing ?? ''}`;
  let cursor: Cursor | null = null;
  if (q.cursor) {
    try {
      cursor = openCursor<Cursor>(q.cursor, aad);
    } catch {
      throw invalidCursor();
    }
    if (typeof cursor.g !== 'number' || typeof cursor.at !== 'string' || typeof cursor.id !== 'string') throw invalidCursor();
  }
  const base = await baseWhere(conn, businessId, f, q);
  if (!base) return empty;

  const where: SQL[] = [base, tabWhere(f, q.tab)];
  if (cursor) {
    where.push(sql`(${f.group} > ${cursor.g} OR (${f.group} = ${cursor.g} AND (${f.sortAt}, part_requests.id) <
      ((${cursor.at}::timestamp AT TIME ZONE 'UTC'), ${cursor.id}::uuid)))`);
  }
  const recs = await sellerSelect(conn, f)
    .where(and(...where))
    .orderBy(f.group, desc(f.sortAt), desc(partRequests.id))
    .limit(PAGE + 1);
  const page = recs.slice(0, PAGE);
  const last = page[page.length - 1];
  const nextCursor = recs.length > PAGE && last ? sealCursor({ g: Number(last.group), at: last.sortAt, id: last.r.id }, aad) : null;

  const [c] = await conn
    .select({
      forYou: sql<number>`count(*) FILTER (WHERE ${tabWhere(f, 'matched')})::int`,
      all: sql<number>`count(*) FILTER (WHERE ${tabWhere(f, 'all')})::int`,
      replied: sql<number>`count(*) FILTER (WHERE ${tabWhere(f, 'replied')})::int`,
    })
    .from(partRequests)
    .where(base);

  return {
    items: await sellerRows(conn, page),
    nextCursor,
    counts: { forYou: Number(c?.forYou ?? 0), all: Number(c?.all ?? 0), replied: Number(c?.replied ?? 0) },
  };
}
