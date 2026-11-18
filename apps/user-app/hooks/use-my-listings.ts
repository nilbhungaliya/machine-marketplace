import { useQuery } from '@tanstack/react-query';
import type { MyListingsGroup } from '@mpm/shared-types';
import { fetchMyListings } from '@/lib/listing-api';
import { listingKeys } from './use-listing';

/**
 * My listings (§10): counts per group plus one page of `group`. Refetched on mount and on focus (an admin's decision
 * has no push yet). Pass `enabled: false` before the business exists.
 */
export function useMyListings(group: MyListingsGroup, page = 1, enabled = true) {
  return useQuery({
    queryKey: listingKeys.mineGroup(group, page),
    queryFn: () => fetchMyListings(group, page),
    enabled,
    refetchOnMount: 'always',
  });
}

/** The drafts list (Post tab's "Drafts (n)", the drafts screen). */
export function useDrafts(enabled = true) {
  return useMyListings('drafts', 1, enabled);
}
