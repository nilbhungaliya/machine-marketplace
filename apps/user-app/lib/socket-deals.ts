import type { QueryClient } from '@tanstack/react-query';

/**
 * `/user` socket events for deals (F6 + F7 spec §13): `deal:updated { dealId, threadId, status, version }` (no text;
 * refetch). Routed here by `routeSocketEvent` (`hooks/useSocket.ts`); invalidates `qk.deal` / `qk.deals`.
 */
// F6F7-STUB(L7): L7-3 refetches the deal and the deals lists.
export function handleDealEvent(_queryClient: QueryClient, _event: string, _data: unknown): void {
  return;
}
