import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { RentalBookingView, RentalEstimateRequest } from '@mpm/shared-types';
import { listingKeys } from '@/hooks/use-listing';
import { useIdempotencyKey } from '@/hooks/use-offers';
import { preparePhoto, putFile } from '@/lib/media-device';
import { qk } from '@/lib/query-keys';
import {
  estimateRental, fetchRentalAvailability, fetchRentalBooking, fetchRentalBookingPhotos, presignBookingPhoto,
} from '@/lib/rentals-api';

// Server state for one rental booking (M14 spec §14.2): the Booking record, its photos, the listing's availability
// strip, the Request booking estimate, and every booking write. A write stores the returned view at once and refetches
// the Rentals lists, the badges, the thread (its booking card and contact banner) and the listing (availability, the
// owner's booking summary). `rental:updated` (lib/socket-rentals.ts) refetches the same keys for the other side.

/** What a booking change makes stale, besides the booking itself. */
export function invalidateAfterBooking(qc: QueryClient, view: Pick<RentalBookingView, 'threadId' | 'listing'> | null): void {
  void qc.invalidateQueries({ queryKey: qk.rentals.all });
  void qc.invalidateQueries({ queryKey: qk.badges() });
  if (!view) return;
  void qc.invalidateQueries({ queryKey: qk.thread(view.threadId) });
  void qc.invalidateQueries({ queryKey: qk.rentals.listing(view.listing.id) });
  void qc.invalidateQueries({ queryKey: listingKeys.detail(view.listing.id) });
}

/** The Booking record (`GET /rental-bookings/:id`). */
export function useRentalBooking(id: string, enabled = true) {
  return useQuery({ queryKey: qk.rentals.booking(id), queryFn: () => fetchRentalBooking(id), enabled: enabled && id !== '' });
}

/** On-site, return and problem photos (300 s URLs). Only when the booking has any. */
export function useRentalBookingPhotos(id: string, enabled: boolean) {
  return useQuery({ queryKey: qk.rentals.bookingPhotos(id), queryFn: () => fetchRentalBookingPhotos(id), enabled, staleTime: 60_000 });
}

/**
 * Every booking write: `run(key)` calls one `lib/rentals-api.ts` function with the tap's `Idempotency-Key` (kept when
 * no answer came back, so a retried tap replays it). A refusal refetches the record: the booking moved on.
 */
export function useBookingWrite(bookingId: string) {
  const qc = useQueryClient();
  const key = useIdempotencyKey();
  return useMutation({
    mutationFn: (run: (key: string) => Promise<RentalBookingView>) => run(key.take()),
    onSuccess: (view) => {
      key.settle();
      qc.setQueryData(qk.rentals.booking(bookingId), view);
      invalidateAfterBooking(qc, view);
    },
    onError: (err) => {
      key.settle(err);
      void qc.invalidateQueries({ queryKey: qk.rentals.booking(bookingId) });
      invalidateAfterBooking(qc, qc.getQueryData<RentalBookingView>(qk.rentals.booking(bookingId)) ?? null);
    },
  });
}

/** The listing's free / partial / full days (public, R13): the 30-day strip and the date sheet's greyed days. */
export function useRentalAvailability(listingId: string, range: { from?: string; to?: string } | null = null, enabled = true) {
  return useQuery({
    queryKey: qk.rentals.availability(listingId, range?.from ?? null, range?.to ?? null),
    queryFn: () => fetchRentalAvailability(listingId, range ?? undefined),
    enabled,
    staleTime: 60_000,
  });
}

/** `value` after it has stayed the same for `ms` (the estimate waits 400 ms after the last change). */
export function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}

/** The live estimate (`POST /rentals/estimate`, debounced 400 ms); idle while the form has no start date. */
export function useRentalEstimate(input: RentalEstimateRequest | null) {
  const json = input ? JSON.stringify(input) : '';
  const settled = useDebounced(json, 400);
  const query = useQuery({
    queryKey: qk.rentals.estimate(input?.listingId ?? '', settled),
    queryFn: () => estimateRental(JSON.parse(settled) as RentalEstimateRequest),
    enabled: settled !== '',
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    retry: false,
  });
  // The total on screen is for an earlier form (still debouncing, or the previous answer kept as a placeholder).
  const stale = json !== settled || query.isPlaceholderData;
  return { ...query, stale };
}

/**
 * One private photo for a booking step (on site, return, problem; plan D8): re-encoded on the phone (no EXIF / GPS),
 * presigned and PUT; returns the upload key the action sends.
 */
export async function uploadBookingPhoto(bookingId: string, uri: string, size?: { width: number; height: number }): Promise<string> {
  const [full] = await preparePhoto(uri, size);
  if (!full) throw Object.assign(new Error('PHOTO_PREPARE_FAILED'), { code: 'PHOTO_PREPARE_FAILED' });
  const signed = await presignBookingPhoto(bookingId, { contentType: full.contentType, contentLength: full.size });
  await putFile(signed.url, full, () => {});
  return signed.key;
}
