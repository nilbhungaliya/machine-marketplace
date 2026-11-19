import { asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { businesses, chatThreads, deals, listings, offers } from '../../db/schema.js';
import { AppError, NotFoundError } from '../../lib/errors.js';

/**
 * Row locks for F6 + F7 (spec §8.5), in **this order** whenever a transaction takes more than one:
 *
 *   buyer business (`FOR NO KEY UPDATE`) → listing(s) (`FOR UPDATE`, id order) → deal (`FOR NO KEY UPDATE`) → offers
 *   (id order) → thread
 *
 * F6 / F7 code **never locks the seller business**: only F2's seller and admin listing writers do (business → listing,
 * `services/listings/locks.ts`), which is compatible with this order because no F6 / F7 transaction holds a listing
 * and then asks for a business. A single listing is locked with F2's `lockListingOnly`.
 */

export type ThreadRow = typeof chatThreads.$inferSelect;
export type DealRow = typeof deals.$inferSelect;
export type OfferRow = typeof offers.$inferSelect;

/** The buyer's business (`FOR NO KEY UPDATE`): serialises one business's enquiries, offers and limits. */
export async function lockBuyerBusiness(tx: Tx, businessId: string): Promise<typeof businesses.$inferSelect> {
  const [row] = await tx.select().from(businesses).where(eq(businesses.id, businessId)).for('no key update');
  if (!row) throw new NotFoundError('Business');
  return row;
}

/** Several listings in id order (block, owner suspension). Missing ids are skipped. */
export async function lockListingsInOrder(tx: Tx, ids: string[]): Promise<Array<typeof listings.$inferSelect>> {
  if (ids.length === 0) return [];
  const sorted = [...new Set(ids)].sort();
  return tx.select().from(listings).where(inArray(listings.id, sorted)).orderBy(asc(listings.id)).for('update');
}

/**
 * `404 DEAL_NOT_FOUND` when it doesn't exist (party checks are the caller's). `FOR NO KEY UPDATE`: deal ids never
 * change, and rows referencing the deal (reviews, events, notifications) take `KEY SHARE` on it, which this doesn't
 * block (no review-publish job vs review submit deadlock).
 */
export async function lockDeal(tx: Tx, dealId: string): Promise<DealRow> {
  const [row] = await tx.select().from(deals).where(eq(deals.id, dealId)).for('no key update');
  if (!row) throw new AppError('Deal not found', 404, 'DEAL_NOT_FOUND');
  return row;
}

/** Offers in id order; missing ids are skipped. */
export async function lockOffers(tx: Tx, ids: string[]): Promise<OfferRow[]> {
  if (ids.length === 0) return [];
  const sorted = [...new Set(ids)].sort();
  return tx.select().from(offers).where(inArray(offers.id, sorted)).orderBy(asc(offers.id)).for('update');
}

/** `404 THREAD_NOT_FOUND` when it doesn't exist. */
export async function lockThread(tx: Tx, threadId: string): Promise<ThreadRow> {
  const [row] = await tx.select().from(chatThreads).where(eq(chatThreads.id, threadId)).for('update');
  if (!row) throw new AppError('Thread not found', 404, 'THREAD_NOT_FOUND');
  return row;
}
