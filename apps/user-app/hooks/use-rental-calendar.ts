import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RentalBlockInput, RentalBookingView } from '@mpm/shared-types';
import { useIdempotencyKey } from '@/hooks/use-offers';
import { invalidateListingLists, listingKeys } from '@/hooks/use-listing';
import { errorCode } from '@/lib/api-error';
import { preparePhoto, putFile } from '@/lib/media-device';
import { qk } from '@/lib/query-keys';
import {
  createRentalBlock, deleteRentalBlock, fetchRentalCalendar, presignBookingPhoto, updateRentalBlock,
} from '@/lib/rentals-api';

// Server state for the owner side of M14 (plan B3-1, B3-2): the owner calendar and its blocks, the owner's booking
// answers and steps, and the step photos. Lists and badges follow every write; the `rental:` socket prefix refreshes
// the rest (`lib/socket-rentals.ts`).

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

/** What a booking write makes stale: the lists, the badges, the thread (its booking card), the listing's calendar. */
function refreshAfterBooking(qc: ReturnType<typeof useQueryClient>, view: RentalBookingView | null) {
  void qc.invalidateQueries({ queryKey: qk.rentals.all });
  void qc.invalidateQueries({ queryKey: qk.badges() });
  if (view) {
    void qc.invalidateQueries({ queryKey: qk.thread(view.threadId) });
    void qc.invalidateQueries({ queryKey: qk.rentals.listing(view.listing.id) });
    void qc.invalidateQueries({ queryKey: listingKeys.owner(view.listing.id) });
    invalidateListingLists(qc, view.listing.id);
  }
}

/**
 * One booking write (confirm, change, decline, on site, returned) with its idempotency key held across a retried tap.
 * The call gets the key; the fresh view is stored at once. A refusal reloads the booking: it moved on (another member,
 * a job), and `409 RENTAL_BOOKING_STALE` means a newer version came in.
 */
export function useRentalBookingWrite(bookingId: string) {
  const qc = useQueryClient();
  const key = useIdempotencyKey();
  return useMutation({
    mutationFn: (call: (idempotencyKey: string) => Promise<RentalBookingView>) => call(key.take()),
    onSuccess: (view) => {
      key.settle();
      qc.setQueryData(qk.rentals.booking(bookingId), view);
      refreshAfterBooking(qc, view);
    },
    onError: (err) => {
      key.settle(err);
      void qc.invalidateQueries({ queryKey: qk.rentals.booking(bookingId) });
      refreshAfterBooking(qc, qc.getQueryData<RentalBookingView>(qk.rentals.booking(bookingId)) ?? null);
    },
  });
}

/** A refusal that means the sheet's copy is out of date: close it and let the record show what it is now. */
export function isStaleBookingError(err: unknown): boolean {
  const code = errorCode(err);
  return code === 'RENTAL_BOOKING_STALE' || code === 'RENTAL_TRANSITION_NOT_ALLOWED' || code === 'RENTAL_BOOKING_NOT_FOUND';
}

/**
 * One private step photo (on site, return; plan D8): re-encoded on the phone (no EXIF / GPS), presigned and PUT;
 * returns the upload key the action sends. The server re-encodes it again when the action lands.
 */
export async function uploadBookingPhoto(bookingId: string, uri: string, size?: { width: number; height: number }): Promise<string> {
  const [full] = await preparePhoto(uri, size);
  if (!full) throw Object.assign(new Error('PHOTO_PREPARE_FAILED'), { code: 'PHOTO_PREPARE_FAILED' });
  const signed = await presignBookingPhoto(bookingId, { contentType: full.contentType, contentLength: full.size });
  await putFile(signed.url, full, () => {});
  return signed.key;
}
