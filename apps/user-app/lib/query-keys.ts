import type { InboxFilter } from '@mpm/shared-types';

/**
 * React Query keys for F6 + F7 (spec §15.3), in one place so the socket handlers (`lib/socket-*.ts`) and every screen
 * patch and invalidate the same entries. Prefixes: `['threads', …]` lists, `['thread', id]` one thread and its messages,
 * `['deals', …]`, `['deal', id]`.
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
};
