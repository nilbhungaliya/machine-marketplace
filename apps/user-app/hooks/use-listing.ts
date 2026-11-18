import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  ListingActionResult, ListingKind, ListingOwnerView, ListingReportRequest, SellerListingAction,
} from '@mpm/shared-types';
import {
  fetchBrands, fetchCategoryTree, fetchListing, fetchListingTemplate, fetchMasterData, fetchModels, fetchOtherSide, fetchOwnerListing,
  fetchSellerListings, fetchTemplate, listingAction, reportListing, templateKindOf,
} from '@/lib/listing-api';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS } from '@/lib/analytics-events';

// Server state for listings (React Query): the public page, the owner view, Other side, a seller's listings, the
// catalogue reads of the sell wizard, and the seller actions. Keys are not user-scoped: useAuth clears the cache on
// sign-in and sign-out.

export const listingKeys = {
  all: ['listings'] as const,
  detail: (id: string) => ['listings', 'detail', id] as const,
  owner: (id: string) => ['listings', 'owner', id] as const,
  otherSide: (id: string) => ['listings', 'other-side', id] as const,
  /** Every Other side list: a listing's change can show in the lists of the listings it pairs with. */
  otherSideAll: ['listings', 'other-side'] as const,
  seller: (businessId: string, exclude?: string) => ['listings', 'seller', businessId, exclude ?? ''] as const,
  /** Every "More from this seller" / seller listings page of one business. */
  sellerAll: (businessId: string) => ['listings', 'seller', businessId] as const,
  mine: ['listings', 'mine'] as const,
  mineGroup: (group: string, page: number) => ['listings', 'mine', group, page] as const,
};

export const catalogKeys = {
  tree: ['catalog', 'tree'] as const,
  template: (nodeId: string, kind: string) => ['catalog', 'template', nodeId, kind] as const,
  /** With retired fields and options (the listing page's Specifications). */
  listingTemplate: (nodeId: string, kind: string) => ['catalog', 'template', nodeId, kind, 'with-retired'] as const,
  brands: (role: string, machineTypeId: string) => ['catalog', 'brands', role, machineTypeId] as const,
  models: (brandId: string, machineTypeId: string) => ['catalog', 'models', brandId, machineTypeId] as const,
  master: ['catalog', 'master-data'] as const,
};

const CATALOG_STALE = 30 * 60 * 1000;

/** The listing page: the public detail, or the owner view when it's the viewer's own (`isOwner`). */
export function useListing(id: string) {
  return useQuery({ queryKey: listingKeys.detail(id), queryFn: () => fetchListing(id), staleTime: 60 * 1000 });
}

/** The owner view in any status (Preview, Edit, My listings' manage sheet). Always refetched on mount. */
export function useOwnerListing(id: string | null) {
  return useQuery({
    queryKey: listingKeys.owner(id ?? ''),
    queryFn: () => fetchOwnerListing(id!),
    enabled: !!id,
    refetchOnMount: 'always',
  });
}

/** The Other side matches of a left / right part (§9). Pass `enabled: false` for other listings. */
export function useOtherSide(id: string, enabled = true) {
  return useQuery({ queryKey: listingKeys.otherSide(id), queryFn: () => fetchOtherSide(id), enabled, staleTime: 60 * 1000 });
}

/** A seller's public listings (More from this seller: `limit` 6 and `exclude` this one; the seller screen: 50). */
export function useSellerListings(businessId: string | null, opts: { limit?: number; exclude?: string } = {}) {
  return useQuery({
    queryKey: [...listingKeys.seller(businessId ?? '', opts.exclude), opts.limit ?? 20],
    queryFn: () => fetchSellerListings(businessId!, opts),
    enabled: !!businessId,
    staleTime: 60 * 1000,
  });
}

/** The active catalogue tree (category step, breadcrumbs). */
export function useCategoryTree() {
  return useQuery({ queryKey: catalogKeys.tree, queryFn: fetchCategoryTree, staleTime: CATALOG_STALE });
}

/** The node's effective template for the listing's kind (details / machine steps, the Specifications block). */
export function useTemplate(nodeId: string | null | undefined, kind: ListingKind) {
  const tk = templateKindOf(kind);
  return useQuery({
    queryKey: catalogKeys.template(nodeId ?? '', tk),
    queryFn: () => fetchTemplate(nodeId!, tk),
    enabled: !!nodeId,
    staleTime: CATALOG_STALE,
  });
}

/**
 * The template of a listing's Specifications block (listing page, Preview): `includeRetired=1`, so the values a listing
 * still holds for retired fields and options keep their labels. The one place listing screens read it.
 */
export function useListingTemplate(listing: { categoryId: string | null; kind: ListingKind } | null | undefined) {
  const nodeId = listing?.categoryId ?? null;
  const tk = templateKindOf(listing?.kind ?? 'part');
  return useQuery({
    queryKey: catalogKeys.listingTemplate(nodeId ?? '', tk),
    queryFn: () => fetchListingTemplate(nodeId!, tk),
    enabled: !!nodeId,
    staleTime: CATALOG_STALE,
  });
}

/** Units and conditions. */
export function useMasterData() {
  return useQuery({ queryKey: catalogKeys.master, queryFn: fetchMasterData, staleTime: CATALOG_STALE });
}

/** Brands that make machines or parts, those with models of `machineTypeId` first. */
export function useBrands(role: 'machines' | 'parts', machineTypeId?: string | null) {
  return useQuery({
    queryKey: catalogKeys.brands(role, machineTypeId ?? ''),
    queryFn: () => fetchBrands({ role, ...(machineTypeId ? { machineTypeId } : {}) }),
    staleTime: CATALOG_STALE,
  });
}

/** Models of a brand (optionally of one machine type). Pass `null` to wait for a brand. */
export function useModels(brandId: string | null, machineTypeId?: string | null) {
  return useQuery({
    queryKey: catalogKeys.models(brandId ?? '', machineTypeId ?? ''),
    queryFn: () => fetchModels({ brandId: brandId!, ...(machineTypeId ? { machineTypeId } : {}) }),
    enabled: !!brandId,
    staleTime: CATALOG_STALE,
  });
}

/**
 * Writes a fresh owner view into the caches that show it, and marks stale every list it can appear in: My listings
 * (drafts included, `listingKeys.mine`), the public page, the seller's listings and the Other side lists.
 */
export function useStoreOwnerView() {
  const qc = useQueryClient();
  return (listing: ListingOwnerView) => {
    qc.setQueryData(listingKeys.owner(listing.id), listing);
    invalidateListingLists(qc, listing.id, listing.businessId);
  };
}

/** The lists and pages a listing change can show in (owner view excluded: the caller writes or refetches it). */
export function invalidateListingLists(qc: QueryClient, listingId: string, businessId?: string | null) {
  void qc.invalidateQueries({ queryKey: listingKeys.mine });
  void qc.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
  void qc.invalidateQueries({ queryKey: listingKeys.otherSideAll });
  if (businessId) void qc.invalidateQueries({ queryKey: listingKeys.sellerAll(businessId) });
}

/**
 * A seller action from the manage sheet (§10): pause, resume, renew, mark sold… The result's `outcome` tells the
 * caller whether a go-live action was sent to review ("Sent to our team for a quick check"). Tracks
 * `listing_action_done { action, outcome }`; failures carry the error code (map it with `listingErrorMessage`).
 */
export function useListingAction() {
  const store = useStoreOwnerView();
  return useMutation({
    mutationFn: (v: { id: string; action: SellerListingAction; note?: string | null }): Promise<ListingActionResult> =>
      listingAction(v.id, v.action, v.note),
    onSuccess: (res, v) => {
      store(res.listing);
      track(LISTING_EVENTS.actionDone, { action: v.action, outcome: res.outcome });
    },
  });
}

/** Report listing (§8.4). Tracks `listing_reported { reason }` on success. */
export function useReportListing() {
  return useMutation({
    mutationFn: (v: { id: string; body: ListingReportRequest }) => reportListing(v.id, v.body),
    onSuccess: (_res, v) => track(LISTING_EVENTS.reported, { reason: v.body.reason }),
  });
}
