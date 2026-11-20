import type { QueryClient } from '@tanstack/react-query';
import { qk } from './query-keys';

/**
 * `/user` socket events for part requests (F8 spec §11): `part_request:updated { partRequestId, reason }` to the buyer
 * business (a delivered reply, a new match, a status change by a job or an admin). Ids only: refetch the request (and
 * its replies / matches / compare, all under `['part-request', id]`), every part-request list and the badges.
 */
export function parsePartRequestUpdated(data: unknown): { partRequestId: string } | null {
  if (!data || typeof data !== 'object') return null;
  const id = (data as Record<string, unknown>).partRequestId;
  return typeof id === 'string' && id !== '' ? { partRequestId: id } : null;
}

export function handlePartRequestEvent(queryClient: QueryClient, event: string, data: unknown): void {
  if (event !== 'part_request:updated') return;
  const update = parsePartRequestUpdated(data);
  if (!update) return;
  void queryClient.invalidateQueries({ queryKey: qk.partRequest(update.partRequestId) });
  void queryClient.invalidateQueries({ queryKey: qk.allPartRequests });
  void queryClient.invalidateQueries({ queryKey: qk.badges() });
}
