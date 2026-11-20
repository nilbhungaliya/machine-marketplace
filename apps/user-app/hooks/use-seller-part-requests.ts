import { useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PartRequestFeedbackReason, PartRequestKind, PartRequestReportReason, SellerPartRequestTab, SendRepliesRequest,
} from '@mpm/shared-types';
import { useStoreOwnerView } from '@/hooks/use-listing';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS, REQUEST_EVENTS } from '@/lib/analytics-events';
import { createListing } from '@/lib/listing-api';
import { keepIdempotencyKey, newIdempotencyKey } from '@/lib/offers-api';
import {
  fetchDemand, fetchPartRequestPhotos, fetchPartRequestsForSellers, fetchReplyOptions, markNotRelevant,
  reportPartRequest, sendReplies, undoNotRelevant, withdrawReply,
} from '@/lib/part-requests-api';
import { qk } from '@/lib/query-keys';

// Server state for the seller's side of part requests (F8 spec §9.2, §9.3, §12.3, §13.1): Buyers looking for your
// parts, the reply picker, send / withdraw, Not relevant, Report, a new listing as a reply, the listing's demand line.
// A write refetches the request (its seller view and reply options sit under `['part-request', id]`), every
// part-request list (Home's strip, Buyers looking) and the badges. Analytics carry ids, counts and codes only.

function useRefreshRequest(partRequestId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.partRequest(partRequestId) });
    void qc.invalidateQueries({ queryKey: qk.allPartRequests });
    void qc.invalidateQueries({ queryKey: qk.badges() });
  };
}

/**
 * Idempotency keys per write target: one key per `target` (a reply id, a send's listings + message), reused while a
 * retry of that same write is possible (no response came back) and dropped once the server answered. A different
 * target never reuses another's key, which the API would refuse (`422 IDEMPOTENCY_KEY_REUSED`).
 */
function useKeysByTarget() {
  const keys = useRef(new Map<string, string>());
  return {
    take(target: string): string {
      let key = keys.current.get(target);
      if (!key) {
        key = newIdempotencyKey();
        keys.current.set(target, key);
      }
      return key;
    },
    settle(target: string, err?: unknown): void {
      if (err === undefined || !keepIdempotencyKey(err)) keys.current.delete(target);
    },
  };
}

/** A send's target: its listings (in any order) and its message, so a changed selection gets a fresh key. */
const sendTarget = (body: SendRepliesRequest): string => JSON.stringify([[...body.listingIds].sort(), body.message ?? null]);

/** Buyers looking for your parts: one infinite list per tab (and `forListing`, a listing's demand). */
export function useSellerPartRequests(tab: SellerPartRequestTab, forListing: string | null, kind: PartRequestKind | null = null) {
  return useInfiniteQuery({
    queryKey: qk.partRequestsForSellers(tab, kind, forListing),
    queryFn: ({ pageParam }) => fetchPartRequestsForSellers({ tab, kind, forListing, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** The reply picker: the seller's live listings of the request's kind, fitting first, plus the slots and daily replies left. */
export function useReplyOptions(partRequestId: string) {
  return useQuery({ queryKey: qk.replyOptions(partRequestId), queryFn: () => fetchReplyOptions(partRequestId), retry: false });
}

/** The request's reference photos (300 s signed URLs): fetched when the seller opens them, never cached for long. */
export function useRequestPhotos(partRequestId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.partRequestPhotos(partRequestId),
    queryFn: () => fetchPartRequestPhotos(partRequestId),
    enabled,
    staleTime: 120_000,
    gcTime: 0,
  });
}

/** Send 1–3 listings as replies (`Idempotency-Key` per selection + message, reused only on a retry of the same send). */
export function useSendReplies(partRequestId: string) {
  const refresh = useRefreshRequest(partRequestId);
  const keys = useKeysByTarget();
  return useMutation({
    mutationFn: (body: SendRepliesRequest) => sendReplies(partRequestId, body, keys.take(sendTarget(body))),
    onSuccess: (_res, body) => {
      keys.settle(sendTarget(body));
      refresh();
      track(REQUEST_EVENTS.requestReplySent, { partRequestId, listings: body.listingIds.length, created: false });
    },
    onError: (err, body) => keys.settle(sendTarget(body), err),
  });
}

/** Withdraw one of the seller's replies (pending or delivered); one `Idempotency-Key` per reply. */
export function useWithdrawReply(partRequestId: string) {
  const refresh = useRefreshRequest(partRequestId);
  const keys = useKeysByTarget();
  return useMutation({
    mutationFn: (replyId: string) => withdrawReply(partRequestId, replyId, keys.take(replyId)),
    onSuccess: (_res, replyId) => {
      keys.settle(replyId);
      refresh();
      track(REQUEST_EVENTS.requestReplyWithdrawn, { partRequestId });
    },
    onError: (err, replyId) => keys.settle(replyId, err),
  });
}

/** Not relevant (with an optional reason) and its Undo. */
export function useNotRelevant(partRequestId: string) {
  const refresh = useRefreshRequest(partRequestId);
  const set = useMutation({
    mutationFn: (reason: PartRequestFeedbackReason | null) => markNotRelevant(partRequestId, reason),
    onSuccess: (_res, reason) => {
      refresh();
      track(REQUEST_EVENTS.requestNotRelevant, { partRequestId, reason: reason ?? 'none' });
    },
  });
  const undo = useMutation({ mutationFn: () => undoNotRelevant(partRequestId), onSuccess: refresh });
  return { set, undo };
}

/** Report a request (`409 REPORT_EXISTS`, `429 REPORT_LIMIT` come back as errors). */
export function useReportPartRequest(partRequestId: string) {
  return useMutation({
    mutationFn: (v: { reason: PartRequestReportReason; details: string | null }) =>
      reportPartRequest(partRequestId, v.reason, v.details),
    onSuccess: (_res, v) => track(REQUEST_EVENTS.requestReported, { partRequestId, reason: v.reason }),
  });
}

/**
 * "Create a new listing" (§9.3): `POST /listings { kind, partRequestId }` makes a prefilled draft and a `pending`
 * reply in one transaction; the caller opens the sell wizard on it. `409 OWN_PART_REQUEST`, `REPLY_LIMIT`,
 * `DRAFT_LIMIT`, `PART_REQUEST_NOT_ACTIVE` and `404` come back as errors (nothing was created).
 */
export function useCreateReplyListing(partRequestId: string) {
  const store = useStoreOwnerView();
  const refresh = useRefreshRequest(partRequestId);
  return useMutation({
    mutationFn: (kind: PartRequestKind) => createListing(kind, partRequestId),
    onSuccess: (listing) => {
      store(listing);
      refresh();
      track(LISTING_EVENTS.sellStarted, { kind: listing.kind });
      track(REQUEST_EVENTS.requestReplySent, { partRequestId, listings: 1, created: true });
    },
  });
}

/** "{n} buyers are looking for this part" on Published (the owner's listing only). */
export function useListingDemand(listingId: string) {
  return useQuery({ queryKey: qk.partRequestDemand(listingId), queryFn: () => fetchDemand(listingId), retry: false });
}
