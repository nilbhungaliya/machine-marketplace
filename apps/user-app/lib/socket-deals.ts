import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { DEAL_STATUSES, type DealStatus, type DealsPage } from '@mpm/shared-types';
import { qk } from './query-keys';

/**
 * `/user` socket events for deals (F6 + F7 spec §13): `deal:updated { dealId, threadId, status, version }` (no text;
 * refetch). Routed here by `routeSocketEvent` (`hooks/useSocket.ts`). The lists get the new status at once (a row moves
 * tabs on the refetch); the Deal record, the lists, the thread (its deal card and contact block) and the badges are
 * refetched. Sent on the number reveal too, with the same status: the refetch shows the number.
 */

export interface DealUpdated {
  dealId: string;
  threadId: string;
  status: DealStatus;
  version: number;
}

/** The event's payload, or null for anything that isn't one (sockets are best-effort, never trusted blindly). */
export function parseDealUpdated(data: unknown): DealUpdated | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.dealId !== 'string' || typeof d.threadId !== 'string') return null;
  if (typeof d.status !== 'string' || !(DEAL_STATUSES as readonly string[]).includes(d.status)) return null;
  if (typeof d.version !== 'number') return null;
  return { dealId: d.dealId, threadId: d.threadId, status: d.status as DealStatus, version: d.version };
}

/** A cached deals list (infinite pages) with the deal's row given the new status; the same object when it isn't there. */
export function patchDealsPages(
  data: InfiniteData<DealsPage> | undefined,
  update: Pick<DealUpdated, 'dealId' | 'status'>,
): InfiniteData<DealsPage> | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    if (!page.items.some((r) => r.id === update.dealId && r.status !== update.status)) return page;
    changed = true;
    return { ...page, items: page.items.map((r) => (r.id === update.dealId ? { ...r, status: update.status } : r)) };
  });
  return changed ? { ...data, pages } : data;
}

export function handleDealEvent(queryClient: QueryClient, event: string, data: unknown): void {
  if (event !== 'deal:updated') return;
  const update = parseDealUpdated(data);
  if (!update) return;
  queryClient.setQueriesData<InfiniteData<DealsPage>>({ queryKey: qk.allDeals }, (old) => patchDealsPages(old, update));
  void queryClient.invalidateQueries({ queryKey: qk.deal(update.dealId) });
  void queryClient.invalidateQueries({ queryKey: qk.allDeals });
  void queryClient.invalidateQueries({ queryKey: qk.thread(update.threadId) });
  void queryClient.invalidateQueries({ queryKey: qk.badges() });
}
