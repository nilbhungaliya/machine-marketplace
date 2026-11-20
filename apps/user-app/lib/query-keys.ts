import type {
  InboxFilter, MyPartRequestTab, PartRequestKind, RentalBookingSideFilter, RentalBookingTab, SellerPartRequestTab,
} from '@mpm/shared-types';

/**
 * React Query keys for F6 + F7 (spec §15.3), in one place so the socket handlers (`lib/socket-*.ts`) and every screen
 * patch and invalidate the same entries. Prefixes: `['threads', …]` lists, `['thread', id]` one thread and its messages,
 * `['deals', …]`, `['deal', id]`. F8 (spec §13.3): lists under `['part-requests', …]`, one request and its parts under
 * `['part-request', id]`; the `part_request:` socket prefix invalidates both. M14 (plan C0-5): lists under
 * `['rentals', …]`, one booking and its parts under `['rental-booking', id]`, a listing's availability and calendar
 * under `['rental-listing', listingId, …]`; the `rental:` socket prefix invalidates the booking, the lists and the
 * badges.
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
  partRequestPhotos: (id: string) => ['part-request', id, 'photos'] as const,
  replyOptions: (id: string) => ['part-request', id, 'reply-options'] as const,
  /** The owner's listing demand line; under `['part-requests', …]` so a request event refreshes it. */
  partRequestDemand: (listingId: string) => ['part-requests', 'demand', listingId] as const,
  // M14 rental bookings.
  rentals: {
    /** Every Rentals list (all tabs, sides and listing filters). */
    all: ['rentals'] as const,
    list: (tab: RentalBookingTab, side: RentalBookingSideFilter, listingId: string | null) =>
      ['rentals', 'list', tab, side, listingId] as const,
    /** The Request booking screen's live estimate (`input`: the request serialised by the caller). */
    estimate: (listingId: string, input: string) => ['rentals', 'estimate', listingId, input] as const,
    booking: (id: string) => ['rental-booking', id] as const,
    bookingReview: (id: string) => ['rental-booking', id, 'review'] as const,
    bookingPhotos: (id: string) => ['rental-booking', id, 'photos'] as const,
    /** Everything cached for one rental listing (availability strip, owner calendar). */
    listing: (listingId: string) => ['rental-listing', listingId] as const,
    availability: (listingId: string, from: string | null, to: string | null) =>
      ['rental-listing', listingId, 'availability', from, to] as const,
    calendar: (listingId: string, from: string | null, to: string | null) =>
      ['rental-listing', listingId, 'calendar', from, to] as const,
  },
};
