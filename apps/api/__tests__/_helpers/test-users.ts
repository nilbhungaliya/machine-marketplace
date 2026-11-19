import { and, eq, inArray, or } from 'drizzle-orm';
import { db, type Db, type Tx } from '../../src/db/index.js';
import {
  businesses,
  listingFitments,
  listingMachines,
  listingMedia,
  listingRentals,
  listingStatusHistory,
  listings,
  reports,
  savedListings,
  users,
} from '../../src/db/schema.js';

/**
 * Integration tests share one test database (TEST_DATABASE_URL), so every suite must delete what it
 * creates (in afterAll). Phones are UNIQUE: mint them from a timestamp, never a
 * short random suffix, or a fuller table makes runs collide and fail by chance.
 */
let seq = 0;
export function uniqueTestPhone(): string {
  // +91 9 + 9 digits from the clock and a per-process counter.
  const n = (Date.now() % 1e7) * 100 + (seq++ % 100);
  return `+919${String(n).padStart(9, '0').slice(-9)}`;
}

/**
 * Deletes the listings of the given businesses and everything that hangs off them (F2 plan Task 2), deepest foreign
 * key first: reports targeting those listings or made by the given businesses / users, status history, media,
 * fitments, rental and machine rows, then the listings. No-op when both lists are empty.
 */
export async function deleteListingsOf(conn: Db | Tx, opts: { businessIds: string[]; userIds?: string[] }): Promise<void> {
  const businessIds = opts.businessIds;
  const userIds = opts.userIds ?? [];
  if (businessIds.length === 0 && userIds.length === 0) return;
  const ids = businessIds.length
    ? (await conn.select({ id: listings.id }).from(listings).where(inArray(listings.businessId, businessIds))).map((r) => r.id)
    : [];
  const reportWhere = [
    ...(ids.length ? [and(eq(reports.targetType, 'listing'), inArray(reports.targetId, ids))] : []),
    ...(businessIds.length ? [inArray(reports.reporterBusinessId, businessIds)] : []),
    ...(userIds.length ? [inArray(reports.reporterUserId, userIds)] : []),
  ];
  if (reportWhere.length) await conn.delete(reports).where(or(...reportWhere));
  // F4 + F5: saved rows of these users (on any listing); the listings' own saved rows go in deleteTestListings. Both
  // would also go by ON DELETE CASCADE.
  if (userIds.length) await conn.delete(savedListings).where(inArray(savedListings.userId, userIds));
  // History rows a user wrote on another business's listing (none today) would block deleting the user.
  if (userIds.length) await conn.delete(listingStatusHistory).where(inArray(listingStatusHistory.userId, userIds));
  await deleteTestListings(conn, ids);
}

/** Deletes the given listings and their children (reports on them, saved rows, history, media, fitments, rental, machine). */
export async function deleteTestListings(conn: Db | Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await conn.delete(reports).where(and(eq(reports.targetType, 'listing'), inArray(reports.targetId, ids)));
  await conn.delete(savedListings).where(inArray(savedListings.listingId, ids));
  await conn.delete(listingStatusHistory).where(inArray(listingStatusHistory.listingId, ids));
  await conn.delete(listingMedia).where(inArray(listingMedia.listingId, ids));
  await conn.delete(listingFitments).where(inArray(listingFitments.listingId, ids));
  await conn.delete(listingRentals).where(inArray(listingRentals.listingId, ids));
  await conn.delete(listingMachines).where(inArray(listingMachines.listingId, ids));
  await conn.delete(listings).where(inArray(listings.id, ids));
}

/**
 * Removes test users and the businesses they created, deepest foreign key first: the businesses' listings (and their
 * children, `deleteListingsOf`), the users, then the businesses.
 * Extend this as tables that reference users are added (enquiries, offers, deals…).
 */
export async function deleteTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const rows = await db.select({ businessId: users.businessId }).from(users).where(inArray(users.id, userIds));
  const businessIds = rows.flatMap((r) => (r.businessId ? [r.businessId] : []));
  await db.transaction((tx) => deleteListingsOf(tx, { businessIds, userIds }));
  await db.delete(users).where(inArray(users.id, userIds));
  for (const businessId of businessIds) await db.delete(businesses).where(eq(businesses.id, businessId));
}
