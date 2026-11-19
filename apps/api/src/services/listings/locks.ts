import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { businesses, listings } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';

// The listing lock order (F2 spec §5.5 step 1, plan Global Constraints): every listing write — PATCH, publish, a
// lifecycle action, a media attach / delete, an admin action — locks the business row first (`FOR NO KEY UPDATE`, as
// F1), then the listing (`FOR UPDATE`), so publishes, relists and edits of one business run one after another and can't
// deadlock. `setMyLocation` takes the business (`FOR NO KEY UPDATE`) before it touches the business's listings, in the same
// order. The one exception is the system `expire` transition (amendment 1): it locks only the listing.

export type ListingRow = typeof listings.$inferSelect;
export type BusinessRow = typeof businesses.$inferSelect;

/** `404 LISTING_NOT_FOUND`, also for someone else's listing, so ids don't leak existence (§14). */
export function listingNotFound(): AppError {
  return new AppError('Listing not found', 404, 'LISTING_NOT_FOUND');
}

/**
 * Locks the business (`FOR NO KEY UPDATE`), then its listing (`FOR UPDATE`), and returns both rows as they are now.
 * `404 LISTING_NOT_FOUND` when the listing doesn't exist or isn't that business's. Taking the locks again inside a
 * transaction that already holds them is a no-op.
 */
export async function lockBusinessThenListing(
  tx: Tx,
  businessId: string,
  listingId: string,
): Promise<{ business: BusinessRow; listing: ListingRow }> {
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, businessId)).for('no key update');
  if (!business) throw listingNotFound();
  const [listing] = await tx
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.businessId, businessId)))
    .for('update');
  if (!listing) throw listingNotFound();
  return { business, listing };
}

/** Locks only the listing (`FOR UPDATE`): the expiry path (amendment 1). `404 LISTING_NOT_FOUND` when it doesn't exist. */
export async function lockListingOnly(tx: Tx, listingId: string): Promise<ListingRow> {
  const [listing] = await tx.select().from(listings).where(eq(listings.id, listingId)).for('update');
  if (!listing) throw listingNotFound();
  return listing;
}
