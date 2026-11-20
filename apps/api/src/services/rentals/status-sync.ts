import type { Tx } from '../../db/index.js';
import { applySystemTransition } from '../listings/listing-lifecycle.service.js';
import type { ListingRow } from '../listings/locks.js';
import { freeToday } from './capacity.js';
import { lockListingForRental } from './locks.js';

/**
 * A rental's `rented` status follows its calendar (M14 spec §7.1, R7; plan C0-3b). With the listing locked (taken here
 * again: a no-op for a caller that holds it, first in §6.7): `live` with nothing free today (IST) → system `rent_out`
 * (→ `rented`); `rented` with a machine free today → system `rent_back` (→ `live`, no gate, as `unreserve`). Any other
 * status (paused, hidden, in review, expired, removed…): nothing — the status that lands on view later is synced by
 * `afterListingStatusWrite`, which every status-writing caller runs.
 *
 * Called after every capacity change (booking writes, blocks, quantity edits), from `afterListingStatusWrite` for
 * `machine_rental` listings, and by the `rental-status-sync` job. `applySystemTransition` never runs
 * `afterListingStatusWrite`, so the sync's own move doesn't re-enter it. `refreshed_at` is untouched (an "available
 * again" isn't a bump). Returns the move made, or null. A part or machine listing is a no-op.
 */
export async function syncRentalStatus(tx: Tx, listing: ListingRow): Promise<'rent_out' | 'rent_back' | null> {
  if (listing.kind !== 'machine_rental') return null;
  const current = await lockListingForRental(tx, listing.id);
  if (current.status !== 'live' && current.status !== 'rented') return null;
  // No quantity (a malformed rental): no calendar to follow, so no move (C0 review M1).
  if (current.quantity == null) return null;
  const free = await freeToday(tx, current.id);
  if (current.status === 'live' && free <= 0) {
    await applySystemTransition(tx, current, 'rent_out', { lockBusiness: false });
    return 'rent_out';
  }
  if (current.status === 'rented' && free > 0) {
    await applySystemTransition(tx, current, 'rent_back', { lockBusiness: false });
    return 'rent_back';
  }
  return null;
}
