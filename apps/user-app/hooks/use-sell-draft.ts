import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ListingKind, ListingPatch } from '@mpm/shared-types';
import { createListing, deleteDraft, patchListing, publishListing } from '@/lib/listing-api';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import type { SellStep } from '@/lib/sell-steps';
import { listingKeys, useOwnerListing, useStoreOwnerView } from './use-listing';

// The sell wizard's draft (F2 spec §5.3, plan Tasks 23–25): create from the Post tab, autosave each step with a PATCH
// (on Next and on Back), publish from Preview, delete from the drafts list. The owner view is the wizard's source of
// truth; every mutation writes the server's answer back into its cache.

/** Post tab → `POST /listings { kind }`. Tracks `sell_started { kind }`. Errors: `RENTAL_NEEDS_GST`, `DRAFT_LIMIT`… */
export function useCreateListing() {
  const store = useStoreOwnerView();
  return useMutation({
    mutationFn: (kind: ListingKind) => createListing(kind),
    onSuccess: (listing) => {
      store(listing);
      track(LISTING_EVENTS.sellStarted, { kind: listing.kind });
    },
  });
}

/**
 * One draft (or a published listing in edit mode): its owner view and `save(patch, step?)`, which PATCHes and stores
 * the answer. With `step`, a successful save tracks `sell_step_completed { kind, step }`.
 */
export function useSellDraft(listingId: string) {
  const query = useOwnerListing(listingId);
  const store = useStoreOwnerView();
  const mutation = useMutation({
    mutationFn: (v: { patch: ListingPatch; step?: SellStep }) => patchListing(listingId, v.patch),
    onSuccess: (listing, v) => {
      store(listing);
      if (v.step) track(LISTING_EVENTS.sellStepCompleted, { kind: listing.kind, step: v.step });
    },
  });
  return {
    listing: query.data ?? null,
    query,
    save: (patch: ListingPatch, step?: SellStep) => mutation.mutateAsync({ patch, step }),
    saving: mutation.isPending,
  };
}

/**
 * Preview's Publish (`POST …/publish`). Tracks `listing_published { kind, outcome }` or `listing_publish_failed
 * { kind, reason }` (the error code). The caller maps `LISTING_INCOMPLETE` problems with `stepForProblem`.
 */
export function usePublishListing(kind: ListingKind | undefined) {
  const store = useStoreOwnerView();
  return useMutation({
    mutationFn: (listingId: string) => publishListing(listingId),
    onSuccess: (res) => {
      store(res.listing);
      track(LISTING_EVENTS.published, { kind: res.listing.kind, outcome: res.outcome });
    },
    onError: (err) => track(LISTING_EVENTS.publishFailed, { kind: kind ?? null, reason: errorCode(err) }),
  });
}

/** Delete a draft (drafts list, confirm first). */
export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (listingId: string) => deleteDraft(listingId),
    onSuccess: (_res, listingId) => {
      qc.removeQueries({ queryKey: listingKeys.owner(listingId) });
      void qc.invalidateQueries({ queryKey: listingKeys.mine });
    },
  });
}
