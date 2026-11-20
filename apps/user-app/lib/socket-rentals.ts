import type { QueryClient } from '@tanstack/react-query';
import type { RentalBookingView } from '@mpm/shared-types';
import { invalidateAfterBooking } from '@/hooks/use-rental-booking';
import { qk } from './query-keys';

/**
 * `/user` socket events for rental bookings (M14 spec §12, plan D12): `rental:updated { bookingId, threadId, status,
 * version }` to both businesses after every status change (and the number reveal). Ids only: refetch the Booking record
 * (and its review / photos, all under `['rental-booking', id]`), every Rentals list, the thread (its booking card), the
 * badges and — through `invalidateAfterBooking`, with the listing id read from the cached view — the listing's calendar
 * and availability, the owner's listing view and My listings. Without a cached view the payload names no listing, so
 * every cached rental listing's calendar and availability is refetched instead.
 */
export function parseRentalUpdated(data: unknown): { bookingId: string; threadId: string | null } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.bookingId !== 'string' || d.bookingId === '') return null;
  return { bookingId: d.bookingId, threadId: typeof d.threadId === 'string' && d.threadId !== '' ? d.threadId : null };
}

export function handleRentalEvent(queryClient: QueryClient, event: string, data: unknown): void {
  if (event !== 'rental:updated') return;
  const update = parseRentalUpdated(data);
  if (!update) return;
  const cached = queryClient.getQueryData<RentalBookingView>(qk.rentals.booking(update.bookingId));
  void queryClient.invalidateQueries({ queryKey: qk.rentals.booking(update.bookingId) });
  if (cached?.listing?.id) {
    // The lists, badges, thread, listing calendar / availability, owner view and My listings.
    invalidateAfterBooking(queryClient, cached);
    return;
  }
  void queryClient.invalidateQueries({ queryKey: qk.rentals.all });
  if (update.threadId) void queryClient.invalidateQueries({ queryKey: qk.thread(update.threadId) });
  void queryClient.invalidateQueries({ queryKey: qk.badges() });
  void queryClient.invalidateQueries({ queryKey: ['rental-listing'] });
}
