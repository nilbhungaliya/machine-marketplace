import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DISCOVERY_LIMITS, type SavedListingItem, type SavedListingsPage, type SaveListingResult } from '@mpm/shared-types';
import type { Db } from '../../db/index.js';
import { listings, savedListings, users } from '../../db/schema.js';
import { ConflictError } from '../../lib/errors.js';
import { listingNotFound } from '../listings/locks.js';
import { cardsInOrder } from './cards.service.js';
import { cursorInvalid, openCursor, sealCursor } from './cursor.js';
import { resolveOrigin } from './origin.js';
import { discoveryWhere } from './visibility.js';

// Saved listings (F4 + F5 spec §4.4, §7, §8.5). A saved row stays whatever happens to its listing; the list works the
// listing's state out at read time: a listing discovery still shows (`discoveryWhere`) comes back as a card with
// `saved: true`, anything else (paused, hidden, sold, removed, owner suspended…) as `unavailable` with no card, so no
// title, photo, price or private field. At most 500 rows per user (`409 SAVED_LIMIT`).

export interface SavedViewer {
  userId: string;
  businessId: string | null;
}

/** The keyset position of a saved list page: the last row's time (as Postgres text, full precision) and listing id. */
interface SavedCursor {
  at: string;
  id: string;
}

/** Postgres `timestamptz::text` ("2026-11-19 10:41:25.123456+00"). */
const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A saved-list cursor is sealed for one user: another user's cursor is `CURSOR_INVALID`. */
const aadFor = (userId: string) => `saved:${userId}`;

/**
 * `PUT /users/me/saved-listings/:listingId`: idempotent. `404 LISTING_NOT_FOUND` unless discovery shows the listing,
 * `409 CANNOT_SAVE_OWN_LISTING` for the viewer's own business, `409 SAVED_LIMIT` for a new row past the cap. The user row
 * is locked (`FOR NO KEY UPDATE`) so two saves can't both pass the cap.
 */
export async function saveListing(db: Db, viewer: SavedViewer, listingId: string): Promise<SaveListingResult> {
  return db.transaction(async (tx) => {
    const [listing] = await tx
      .select({ businessId: listings.businessId })
      .from(listings)
      .where(and(eq(listings.id, listingId), discoveryWhere(listings)));
    if (!listing) throw listingNotFound();
    if (viewer.businessId && listing.businessId === viewer.businessId) {
      throw new ConflictError('This is your own listing', 'CANNOT_SAVE_OWN_LISTING');
    }
    await tx.select({ id: users.id }).from(users).where(eq(users.id, viewer.userId)).for('no key update');
    const [already] = await tx
      .select({ id: savedListings.listingId })
      .from(savedListings)
      .where(and(eq(savedListings.userId, viewer.userId), eq(savedListings.listingId, listingId)));
    if (already) return { saved: true };
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(savedListings).where(eq(savedListings.userId, viewer.userId));
    if (Number(count?.n ?? 0) >= DISCOVERY_LIMITS.savedCap) {
      throw new ConflictError(`You can save up to ${DISCOVERY_LIMITS.savedCap} listings`, 'SAVED_LIMIT', { cap: DISCOVERY_LIMITS.savedCap });
    }
    await tx.insert(savedListings).values({ userId: viewer.userId, listingId }).onConflictDoNothing();
    return { saved: true };
  });
}

/** `DELETE /users/me/saved-listings/:listingId`: always `{ saved: false }`, whatever the listing's state. */
export async function unsaveListing(db: Db, userId: string, listingId: string): Promise<SaveListingResult> {
  await db.delete(savedListings).where(and(eq(savedListings.userId, userId), eq(savedListings.listingId, listingId)));
  return { saved: false };
}

/** `GET /users/me/saved-listings?cursor=`: newest first, 20 a page, a sealed keyset cursor bound to the user. */
export async function listSavedListings(db: Db, viewer: SavedViewer, cursor?: string | null): Promise<SavedListingsPage> {
  let after: SavedCursor | null = null;
  if (cursor) {
    after = openCursor<SavedCursor>(cursor, aadFor(viewer.userId));
    if (typeof after.at !== 'string' || !TIMESTAMP_TEXT.test(after.at) || typeof after.id !== 'string' || !UUID_RE.test(after.id)) {
      throw cursorInvalid();
    }
  }
  const size = DISCOVERY_LIMITS.pageSize;
  const rows = await db
    .select({ listingId: savedListings.listingId, savedAt: savedListings.createdAt, savedAtText: sql<string>`${savedListings.createdAt}::text` })
    .from(savedListings)
    .where(
      and(
        eq(savedListings.userId, viewer.userId),
        after ? sql`(${savedListings.createdAt}, ${savedListings.listingId}) < (${after.at}::timestamptz, ${after.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(savedListings.createdAt), desc(savedListings.listingId))
    .limit(size + 1);
  const page = rows.slice(0, size);
  const last = page[page.length - 1];

  const ids = page.map((r) => r.listingId);
  const visible = ids.length
    ? await db.select({ id: listings.id }).from(listings).where(and(inArray(listings.id, ids), discoveryWhere(listings)))
    : [];
  const shown = new Set(visible.map((r) => r.id));
  // Distances from the business location, as Home and search show them (snapped `search_point`); none without one.
  const origin = shown.size ? await resolveOrigin(db, { business: true }, viewer) : null;
  const cards = await cardsInOrder(
    db,
    ids.filter((id) => shown.has(id)),
    { viewerUserId: viewer.userId, viewerBusinessId: viewer.businessId, origin: origin?.point ?? null },
  );
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const items: SavedListingItem[] = page.map((r) => {
    const card = cardById.get(r.listingId);
    const savedAt = r.savedAt.toISOString();
    return card ? { listingId: r.listingId, savedAt, card } : { listingId: r.listingId, savedAt, unavailable: true };
  });
  return {
    items,
    nextCursor: rows.length > size && last ? sealCursor({ at: last.savedAtText, id: last.listingId } satisfies SavedCursor, aadFor(viewer.userId)) : null,
  };
}
