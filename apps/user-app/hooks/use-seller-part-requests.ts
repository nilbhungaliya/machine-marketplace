import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PartRequestFeedbackReason, PartRequestKind, PartRequestReportReason, SellerPartRequestTab, SendRepliesRequest,
} from '@mpm/shared-types';
import { useIdempotencyKey } from '@/hooks/use-offers';
import { useStoreOwnerView } from '@/hooks/use-listing';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS, REQUEST_EVENTS } from '@/lib/analytics-events';
import { createListing } from '@/lib/listing-api';
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
    queryKey: [...qk.partRequest(partRequestId), 'photos'] as const,
    queryFn: () => fetchPartRequestPhotos(partRequestId),
    enabled,
    staleTime: 120_000,
    gcTime: 0,
  });
}

/** Send 1–3 listings as replies (`Idempotency-Key` per tap, reused on a retry). */
export function useSendReplies(partRequestId: string) {
  const refresh = useRefreshRequest(partRequestId);
  const key = useIdempotencyKey();
  return useMutation({
    mutationFn: (body: SendRepliesRequest) => sendReplies(partRequestId, body, key.take()),
    onSuccess: (_res, body) => {
      key.settle();
      refresh();
      track(REQUEST_EVENTS.requestReplySent, { partRequestId, listings: body.listingIds.length, created: false });
    },
    onError: (err) => key.settle(err),
  });
}

/** Withdraw one of the seller's replies (pending or delivered). */
export function useWithdrawReply(partRequestId: string) {
  const refresh = useRefreshRequest(partRequestId);
  const key = useIdempotencyKey();
  return useMutation({
    mutationFn: (replyId: string) => withdrawReply(partRequestId, replyId, key.take()),
    onSuccess: () => {
      key.settle();
      refresh();
      track(REQUEST_EVENTS.requestReplyWithdrawn, { partRequestId });
    },
    onError: (err) => key.settle(err),
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
