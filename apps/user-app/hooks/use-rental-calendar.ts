import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RentalBlockInput } from '@mpm/shared-types';
import { invalidateListingLists, listingKeys } from '@/hooks/use-listing';
import { qk } from '@/lib/query-keys';
import {
  createRentalBlock, deleteRentalBlock, fetchRentalCalendar, updateRentalBlock,
} from '@/lib/rentals-api';

// Server state for the owner calendar of M14 (plan B3-2): the calendar grid and its blocks. Booking writes, step photos
// and their refreshes live in `hooks/use-rental-booking.ts`; the `rental:` socket prefix refreshes the rest
// (`lib/socket-rentals.ts`).

/** `GET /listings/:id/calendar` for the grid's window (≤ 42 days); the previous month stays on screen while it loads. */
export function useRentalCalendar(listingId: string, range: { from: string; to: string }) {
  return useQuery({
    queryKey: qk.rentals.calendar(listingId, range.from, range.to),
    queryFn: () => fetchRentalCalendar(listingId, range),
    placeholderData: keepPreviousData,
  });
}

export type BlockWrite =
  | { type: 'create'; input: RentalBlockInput }
  | { type: 'update'; blockId: string; input: RentalBlockInput }
  | { type: 'delete'; blockId: string };

/**
 * Add, edit or delete a block (§7.3). Each refreshes the listing's calendar and availability, and the listing itself
 * (a block covering today can turn it `rented`, §7.1).
 */
export function useRentalBlockWrite(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: BlockWrite): Promise<unknown> => {
      if (w.type === 'create') return createRentalBlock(listingId, w.input);
      if (w.type === 'update') return updateRentalBlock(w.blockId, w.input);
      return deleteRentalBlock(w.blockId);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.rentals.listing(listingId) });
      void qc.invalidateQueries({ queryKey: listingKeys.owner(listingId) });
      invalidateListingLists(qc, listingId);
    },
  });
}
