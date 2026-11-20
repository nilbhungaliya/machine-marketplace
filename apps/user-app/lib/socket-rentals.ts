import type { QueryClient } from '@tanstack/react-query';
import { qk } from './query-keys';

/**
 * `/user` socket events for rental bookings (M14 spec §12, plan D12): `rental:updated { bookingId, threadId, status,
 * version }` to both businesses after every status change (and the number reveal). Ids only: refetch the Booking record
 * (and its review / photos, all under `['rental-booking', id]`), every Rentals list, the thread (its booking card) and
 * the badges.
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
  void queryClient.invalidateQueries({ queryKey: qk.rentals.booking(update.bookingId) });
  void queryClient.invalidateQueries({ queryKey: qk.rentals.all });
  if (update.threadId) void queryClient.invalidateQueries({ queryKey: qk.thread(update.threadId) });
  void queryClient.invalidateQueries({ queryKey: qk.badges() });
}
