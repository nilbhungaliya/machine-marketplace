import type { InboxFilter, MyPartRequestTab, PartRequestKind, SellerPartRequestTab } from '@mpm/shared-types';

/**
 * React Query keys for F6 + F7 (spec §15.3), in one place so the socket handlers (`lib/socket-*.ts`) and every screen
 * patch and invalidate the same entries. Prefixes: `['threads', …]` lists, `['thread', id]` one thread and its messages,
 * `['deals', …]`, `['deal', id]`. F8 (spec §13.3): lists under `['part-requests', …]`, one request and its parts under
 * `['part-request', id]`; the `part_request:` socket prefix invalidates both.
 */

export type DealsTab = 'active' | 'completed' | 'cancelled';
export type DealsSide = 'all' | 'buying' | 'selling';

export const qk = {
  /** Every inbox list (all filters): invalidate this on a new message. */
  allThreads: ['threads'] as const,
  threads: (filter: InboxFilter, archived: boolean) => ['threads', filter, archived] as const,
  thread: (id: string) => ['thread', id] as const,
  messages: (id: string) => ['thread', id, 'messages'] as const,
  /** Every deals list. */
  allDeals: ['deals'] as const,
  deals: (tab: DealsTab, side: DealsSide) => ['deals', tab, side] as const,
  deal: (id: string) => ['deal', id] as const,
  reviewState: (dealId: string) => ['deal', dealId, 'review'] as const,
  sellerReviews: (businessId: string) => ['reviews', 'seller', businessId] as const,
  myReviews: () => ['reviews', 'mine'] as const,
  notifications: () => ['notifications'] as const,
  badges: () => ['badges'] as const,
  offersOptions: () => ['offers', 'options'] as const,
  // F8 part requests.
  /** Every part-request list (mine, for sellers, home, options). */
  allPartRequests: ['part-requests'] as const,
  partRequestsMine: (status: MyPartRequestTab) => ['part-requests', 'mine', status] as const,
  partRequestsForSellers: (tab: SellerPartRequestTab, kind: PartRequestKind | null, forListing: string | null) =>
    ['part-requests', 'for-sellers', tab, kind, forListing] as const,
  partRequestHome: () => ['part-requests', 'home'] as const,
  partRequestOptions: () => ['part-requests', 'options'] as const,
  partRequest: (id: string) => ['part-request', id] as const,
  partRequestReplies: (id: string) => ['part-request', id, 'replies'] as const,
  partRequestMatches: (id: string) => ['part-request', id, 'matches'] as const,
  partRequestCompare: (id: string) => ['part-request', id, 'compare'] as const,
  replyOptions: (id: string) => ['part-request', id, 'reply-options'] as const,
  /** The owner's listing demand line; under `['part-requests', …]` so a request event refreshes it. */
  partRequestDemand: (listingId: string) => ['part-requests', 'demand', listingId] as const,
};
