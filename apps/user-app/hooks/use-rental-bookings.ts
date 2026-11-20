import { useInfiniteQuery } from '@tanstack/react-query';
import type { RentalBookingSideFilter, RentalBookingTab } from '@mpm/shared-types';
import { qk } from '@/lib/query-keys';
import { fetchRentalBookings } from '@/lib/rentals-api';

/** The Deals tab's Rentals list (plan D15): one infinite list per tab × side (× listing filter from My listings). */
export function useRentalBookings(tab: RentalBookingTab, side: RentalBookingSideFilter, listingId: string | null = null, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.rentals.list(tab, side, listingId),
    queryFn: ({ pageParam }) => fetchRentalBookings({ tab, side, listingId: listingId ?? undefined, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}
