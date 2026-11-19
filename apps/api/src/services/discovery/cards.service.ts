import { and, inArray } from 'drizzle-orm';
import type { CardsRequest, ListingCard } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { loadCards, type LoadCardsOptions } from '../listings/listing-view.service.js';
import type { ListingRow } from '../listings/locks.js';
import { resolveOrigin, type OriginViewer } from './origin.js';
import { discoveryWhere } from './visibility.js';

// Cards for a list of listing ids (F4 + F5 spec §7): `POST /discover/cards` (recently viewed, kept on the phone, R13) and
// the lists Home builds. Only listings discovery shows (`discoveryWhere`) become cards.

type Conn = Db | Tx;

/** Cards for `ids` in that order (ids without a row are dropped). The caller has already checked visibility. */
export async function cardsInOrder(conn: Conn, ids: readonly string[], opts: LoadCardsOptions): Promise<ListingCard[]> {
  if (ids.length === 0) return [];
  const rows = await conn.select().from(listings).where(inArray(listings.id, [...ids]));
  const byId = new Map(rows.map((r) => [r.id, r as ListingRow]));
  const ordered = ids.map((id) => byId.get(id)).filter((r): r is ListingRow => r !== undefined);
  return loadCards(conn, ordered, opts);
}

/** `POST /discover/cards`: the ids still shown by discovery, in the given order, once each (≤ 20, checked by the route). */
export async function discoverCards(db: Db, req: CardsRequest, viewer: OriginViewer): Promise<ListingCard[]> {
  const origin = await resolveOrigin(db, req.origin ?? undefined, viewer);
  const wanted = [...new Set(req.ids)];
  if (wanted.length === 0) return [];
  const visible = await db
    .select({ id: listings.id })
    .from(listings)
    .where(and(inArray(listings.id, wanted), discoveryWhere(listings)));
  const shown = new Set(visible.map((r) => r.id));
  return cardsInOrder(
    db,
    wanted.filter((id) => shown.has(id)),
    { viewerUserId: viewer?.userId ?? null, origin: origin.point },
  );
}
