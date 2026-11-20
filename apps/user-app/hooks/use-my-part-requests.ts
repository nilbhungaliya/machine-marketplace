import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  MyPartRequestTab,
  PartRequestBuyerView,
  PartRequestCloseReason,
  PartRequestInput,
  PartRequestPatch,
} from '@mpm/shared-types';
import { useMemo, useRef } from 'react';
import { keepIdempotencyKey, newIdempotencyKey } from '@/lib/offers-api';
import {
  closePartRequest,
  createPartRequest,
  fetchMyPartRequests,
  fetchPartRequestCompare,
  fetchPartRequestMatches,
  fetchPartRequestPhotos,
  fetchPartRequestReplies,
  fulfilPartRequest,
  markPartRequestRead,
  renewPartRequest,
  updatePartRequest,
} from '@/lib/part-requests-api';
import { qk } from '@/lib/query-keys';

// The buyer's side of part requests (F8 spec §12.2, §13.1): My requirements, a request's replies / matches / compare /
// photos, and every buyer write. Writes send an `Idempotency-Key` made once per user action and reused on a retry
// (`useIdempotencyKey`), store the returned buyer view and refetch the lists, Home's strip and the badges.

/** My requirements: one infinite list per tab (`closed` = closed + expired + removed). */
export function useMyPartRequests(tab: MyPartRequestTab) {
  return useInfiniteQuery({
    queryKey: qk.partRequestsMine(tab),
    queryFn: ({ pageParam }) => fetchMyPartRequests(tab, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function usePartRequestReplies(id: string, enabled = true) {
  return useQuery({ queryKey: qk.partRequestReplies(id), queryFn: () => fetchPartRequestReplies(id), enabled });
}

export function usePartRequestMatches(id: string, enabled = true) {
  return useQuery({ queryKey: qk.partRequestMatches(id), queryFn: () => fetchPartRequestMatches(id), enabled });
}

export function usePartRequestCompare(id: string) {
  return useQuery({ queryKey: qk.partRequestCompare(id), queryFn: () => fetchPartRequestCompare(id) });
}

/** The request's private photos (300 s URLs): never cached past a minute. Under `['part-request', id]` like the rest. */
export function usePartRequestPhotos(id: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.partRequestPhotos(id ?? ''),
    queryFn: () => fetchPartRequestPhotos(id!),
    enabled: enabled && !!id,
    staleTime: 60_000,
    gcTime: 120_000,
  });
}

/** After any buyer write: the request itself (and its replies / matches), every list, Home's strip, the badges. */
export function refreshAfterRequestWrite(qc: QueryClient, view: PartRequestBuyerView | null, id?: string): void {
  if (view) qc.setQueryData(qk.partRequest(view.id), view);
  const target = view?.id ?? id;
  if (target) void qc.invalidateQueries({ queryKey: qk.partRequest(target) });
  void qc.invalidateQueries({ queryKey: qk.allPartRequests });
  void qc.invalidateQueries({ queryKey: qk.badges() });
}

/** `POST /part-requests`. The caller passes the key (one per body, kept for a retry of the same body). */
export function useCreatePartRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { input: PartRequestInput; key: string }) => createPartRequest(v.input, v.key),
    onSuccess: (view) => refreshAfterRequestWrite(qc, view),
  });
}

/** `PATCH /part-requests/:id` with the loaded `version` (`409 PART_REQUEST_STALE` → reload). */
export function useUpdatePartRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { patch: PartRequestPatch; key: string }) => updatePartRequest(id, v.patch, v.key),
    onSuccess: (view) => refreshAfterRequestWrite(qc, view),
  });
}

type BuyerAction =
  | { type: 'renew'; days: number }
  | { type: 'close'; reason: PartRequestCloseReason }
  | { type: 'fulfil'; dealId: string | null };

/**
 * One `Idempotency-Key` per action and body: the same action with the same body (a retry after a lost answer) reuses
 * it; a different action or body takes a new one, and an answer from the server drops it.
 */
export function useBodyIdempotencyKey() {
  const ref = useRef<{ id: string; key: string } | null>(null);
  return useMemo(() => ({
    take(action: string, body: unknown): string {
      const id = `${action}:${JSON.stringify(body)}`;
      if (ref.current?.id !== id) ref.current = { id, key: newIdempotencyKey() };
      return ref.current.key;
    },
    settle(err?: unknown): void {
      if (err === undefined || !keepIdempotencyKey(err)) ref.current = null;
    },
  }), []);
}

/** Renew, close and mark fulfilled: one idempotency key per action and body, kept while the outcome is unknown. */
export function useRequestAction(id: string) {
  const qc = useQueryClient();
  const key = useBodyIdempotencyKey();
  return useMutation({
    mutationFn: (a: BuyerAction): Promise<PartRequestBuyerView> => {
      const k = key.take(a.type, a);
      if (a.type === 'renew') return renewPartRequest(id, a.days, k);
      if (a.type === 'close') return closePartRequest(id, a.reason, k);
      return fulfilPartRequest(id, a.dealId, k);
    },
    onSuccess: (view) => {
      key.settle();
      refreshAfterRequestWrite(qc, view);
    },
    onError: (err) => {
      key.settle(err);
      // A refused action (stale, not allowed) means the page is out of date.
      refreshAfterRequestWrite(qc, null, id);
    },
  });
}

/** The buyer opened the page (or a live event arrived): grouped rows read, replies seen; Home and badges refetched. */
export function useMarkRequestRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markPartRequestRead(id),
    onSuccess: () => {
      // My requirements' new counts and Home's strip (`allPartRequests` covers every tab and `home`).
      void qc.invalidateQueries({ queryKey: qk.allPartRequests });
      void qc.invalidateQueries({ queryKey: qk.badges() });
    },
  });
}
