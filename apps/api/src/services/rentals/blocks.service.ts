import { eq, sql } from 'drizzle-orm';
import { RENTAL_LIMITS, type RentalBlockInput, type RentalBlockView } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { rentalBlocks } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { istToday } from '../../lib/ist.js';
import { runTx, type TxApp } from '../../lib/tx-effects.js';
import { listingNotFound, lockBusinessThenListing, type ListingRow } from '../listings/locks.js';
import { daysBetween, rentalDatesInvalid } from './availability.service.js';
import { toBlockView } from './calendar.service.js';
import { assertCapacity, machinesOf } from './capacity.js';
import { syncRentalStatus } from './status-sync.js';

// Owner calendar blocks (M14 spec §5.4, §7.3, R5; plan A2-1): maintenance, "booked outside the app" (which replaced the
// retired "Mark rented") or other. Every write locks the business, then the listing (`lockBusinessThenListing`, §6.7:
// blocks are capacity writers), checks capacity when it adds load (create, widen, more machines; `409
// RENTAL_DATES_TAKEN`), and then runs `syncRentalStatus` so a block covering today moves `rented`.

type User = { userId: string; businessId: string | null };
type BlockRow = typeof rentalBlocks.$inferSelect;
/** `RentalBlockInput`; a null note clears it. */
export type BlockInput = Omit<RentalBlockInput, 'note'> & { note?: string | null };

/** The owner's rental listing, locked (business → listing). Someone else's listing, or a removed one: 404. */
async function lockOwnerRental(tx: Tx, user: User, listingId: string): Promise<ListingRow> {
  if (!user.businessId) throw listingNotFound();
  const { listing } = await lockBusinessThenListing(tx, user.businessId, listingId);
  if (listing.kind !== 'machine_rental' || listing.status === 'removed') throw listingNotFound();
  return listing;
}

/** The block's dates and machines are valid for this listing (`400 RENTAL_DATES_INVALID` / `RENTAL_MACHINES_INVALID`). */
function checkShape(b: Pick<RentalBlockInput, 'startDate' | 'endDate' | 'machines'>, listing: ListingRow, today: string): void {
  if (b.endDate < b.startDate) throw rentalDatesInvalid('endDate');
  if (daysBetween(b.startDate, b.endDate) + 1 > RENTAL_LIMITS.blockRangeMaxDays) throw rentalDatesInvalid('endDate');
  if (b.endDate < today) throw rentalDatesInvalid('endDate');
  if (b.machines < 1 || b.machines > machinesOf(listing)) {
    throw new ValidationError('That many machines isn’t possible', { field: 'machines' }, 'RENTAL_MACHINES_INVALID');
  }
}

/** Days from today on (a block that started earlier counts only for what is still ahead). */
const ahead = (b: { startDate: string; endDate: string }, today: string) => ({ from: b.startDate > today ? b.startDate : today, to: b.endDate });

/** `POST /listings/:id/rental-blocks` (owner, non-viewer). */
export async function createBlock(app: TxApp, user: User, listingId: string, input: BlockInput): Promise<RentalBlockView> {
  return runTx(app, async (tx) => {
    const listing = await lockOwnerRental(tx, user, listingId);
    const today = istToday();
    checkShape(input, listing, today);
    await assertCapacity(tx, { id: listing.id, quantity: machinesOf(listing) }, ahead(input, today), input.machines);
    const [row] = await tx
      .insert(rentalBlocks)
      .values({
        listingId: listing.id,
        startDate: input.startDate,
        endDate: input.endDate,
        machines: input.machines,
        reason: input.reason,
        note: input.note ?? null,
        createdByUserId: user.userId,
      })
      .returning();
    await syncRentalStatus(tx, listing);
    return toBlockView(row!);
  });
}

/**
 * Reads the block unlocked to find its listing, locks business → listing, then re-reads it. A block that doesn't exist
 * or sits on someone else's listing: `404 LISTING_NOT_FOUND` (the block is part of its listing's calendar).
 */
async function lockBlock(tx: Tx, user: User, blockId: string): Promise<{ listing: ListingRow; block: BlockRow }> {
  const [found] = await tx.select({ listingId: rentalBlocks.listingId }).from(rentalBlocks).where(eq(rentalBlocks.id, blockId));
  if (!found) throw listingNotFound();
  const listing = await lockOwnerRental(tx, user, found.listingId);
  const [block] = await tx.select().from(rentalBlocks).where(eq(rentalBlocks.id, blockId));
  if (!block || block.listingId !== listing.id) throw listingNotFound();
  return { listing, block };
}

/**
 * `PATCH /rental-blocks/:id` (owner, non-viewer): any of the fields; the rest stay. When the edit adds load (an
 * earlier start, a later end, more machines) the new span is checked with the block counted (`409
 * RENTAL_DATES_TAKEN`); a narrowing edit is never refused for an overrun it didn't cause.
 */
export async function updateBlock(app: TxApp, user: User, blockId: string, input: Partial<BlockInput>): Promise<RentalBlockView> {
  return runTx(app, async (tx) => {
    const { listing, block } = await lockBlock(tx, user, blockId);
    const next = {
      startDate: input.startDate ?? block.startDate,
      endDate: input.endDate ?? block.endDate,
      machines: input.machines ?? block.machines,
    };
    const today = istToday();
    // A note- or reason-only edit (even on a block in the past) isn't checked; dates or machines that change are.
    const reshaped = next.startDate !== block.startDate || next.endDate !== block.endDate || next.machines !== block.machines;
    if (reshaped) checkShape(next, listing, today);
    const [row] = await tx
      .update(rentalBlocks)
      .set({
        ...next,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.note !== undefined ? { note: input.note ?? null } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(rentalBlocks.id, block.id))
      .returning();
    const adds = next.startDate < block.startDate || next.endDate > block.endDate || next.machines > block.machines;
    // The block is already in the count: nothing more may fit on any day of its span.
    if (adds) await assertCapacity(tx, { id: listing.id, quantity: machinesOf(listing) }, ahead(next, today), 0);
    await syncRentalStatus(tx, listing);
    return toBlockView(row!);
  });
}

/** `DELETE /rental-blocks/:id` (owner, non-viewer): hard delete (§5.4), then the status sync. */
export async function deleteBlock(app: TxApp, user: User, blockId: string): Promise<{ id: string }> {
  return runTx(app, async (tx) => {
    const { listing, block } = await lockBlock(tx, user, blockId);
    await tx.delete(rentalBlocks).where(eq(rentalBlocks.id, block.id));
    await syncRentalStatus(tx, listing);
    return { id: block.id };
  });
}
