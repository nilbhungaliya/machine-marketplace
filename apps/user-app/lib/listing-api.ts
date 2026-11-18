import type {
  ApiSuccess, Brand, CategoryNode, CreateListingRequest, EffectiveTemplate, ListingActionRequest, ListingActionResult,
  ListingCard, ListingDeleteResult, ListingDetail, ListingKind, ListingOwnerView, ListingPatch, ListingReportRequest,
  ListingReportResult, MachineModel, MasterData, MediaAttachRequest, MediaAttachResult, MediaDeleteResult,
  MediaOrderResult, MediaPresignRequest, MediaPresignResult, MyListingsGroup, MyListingsView, OtherSideResult,
  SellerListingAction, TemplateKind,
} from '@mpm/shared-types';
import api from './api';

// One function per listing endpoint the app calls (F2 spec §14 user + public routes; plan Task 21), plus the catalogue
// reads the sell wizard needs (`apps/api/src/routes/catalog.ts`). Errors are axios errors: map them with
// `lib/listing-errors.ts`.

const data = <T>(p: Promise<{ data: ApiSuccess<T> }>): Promise<T> => p.then((r) => r.data.data);

// ─── Seller ───

/** POST /listings → the new draft (201). `403 RENTAL_NEEDS_GST`, `409 DRAFT_LIMIT` / `ONBOARDING_INCOMPLETE` / `NO_MACHINE_UNIT`. */
export function createListing(kind: ListingKind): Promise<ListingOwnerView> {
  const body: CreateListingRequest = { kind };
  return data(api.post<ApiSuccess<ListingOwnerView>>('/listings', body));
}

/** GET /listings/mine?group=&page= → counts per group plus one page. */
export function fetchMyListings(group: MyListingsGroup, page = 1): Promise<MyListingsView> {
  return data(api.get<ApiSuccess<MyListingsView>>('/listings/mine', { params: { group, page } }));
}

/** GET /listings/:id/owner → the owner view in any status (404 for someone else's). */
export function fetchOwnerListing(id: string): Promise<ListingOwnerView> {
  return data(api.get<ApiSuccess<ListingOwnerView>>(`/listings/${id}/owner`));
}

/** PATCH /listings/:id: only the fields sent change (autosave on Next / Back, Edit's Save). */
export function patchListing(id: string, patch: ListingPatch): Promise<ListingOwnerView> {
  return data(api.patch<ApiSuccess<ListingOwnerView>>(`/listings/${id}`, patch));
}

/** DELETE /listings/:id (drafts only). */
export function deleteDraft(id: string): Promise<ListingDeleteResult> {
  return data(api.delete<ApiSuccess<ListingDeleteResult>>(`/listings/${id}`));
}

/** POST /listings/:id/publish → `{ listing, outcome }` (`live` or `pending_review`); `400 LISTING_INCOMPLETE` with problems. */
export function publishListing(id: string): Promise<ListingActionResult> {
  return data(api.post<ApiSuccess<ListingActionResult>>(`/listings/${id}/publish`));
}

/** POST /listings/:id/actions (pause, resume, renew, mark sold…) → `{ listing, outcome }`. */
export function listingAction(id: string, action: SellerListingAction, note?: string | null): Promise<ListingActionResult> {
  const body: ListingActionRequest = { action, ...(note ? { note } : {}) };
  return data(api.post<ApiSuccess<ListingActionResult>>(`/listings/${id}/actions`, body));
}

// ─── Media (§6.2) ───

export function presignMedia(id: string, body: MediaPresignRequest): Promise<MediaPresignResult> {
  return data(api.post<ApiSuccess<MediaPresignResult>>(`/listings/${id}/media/presign`, body));
}

export function attachMedia(id: string, body: MediaAttachRequest): Promise<MediaAttachResult> {
  // The server copies the files across buckets before answering: give it longer than the default 15 s.
  return data(api.post<ApiSuccess<MediaAttachResult>>(`/listings/${id}/media`, body, { timeout: 60_000 }));
}

/** PUT /listings/:id/media/order: every media id; the first photo is the cover. */
export function orderMedia(id: string, ids: string[]): Promise<MediaOrderResult> {
  return data(api.put<ApiSuccess<MediaOrderResult>>(`/listings/${id}/media/order`, { ids }));
}

export function deleteMedia(id: string, mediaId: string): Promise<MediaDeleteResult> {
  return data(api.delete<ApiSuccess<MediaDeleteResult>>(`/listings/${id}/media/${mediaId}`));
}

// ─── Public ───

/** GET /listings/:id → the public page, or the owner view when `isOwner`. 404 for anything not public. */
export function fetchListing(id: string): Promise<ListingDetail | ListingOwnerView> {
  return data(api.get<ApiSuccess<ListingDetail | ListingOwnerView>>(`/listings/${id}`));
}

/** GET /listings/:id/other-side. */
export function fetchOtherSide(id: string): Promise<OtherSideResult> {
  return data(api.get<ApiSuccess<OtherSideResult>>(`/listings/${id}/other-side`));
}

/** GET /businesses/:id/listings?limit=&exclude= → a seller's public listings, newest first. */
export function fetchSellerListings(businessId: string, opts: { limit?: number; exclude?: string } = {}): Promise<ListingCard[]> {
  return data(api.get<ApiSuccess<ListingCard[]>>(`/businesses/${businessId}/listings`, { params: opts }));
}

/** POST /listings/:id/reports (201). `409 REPORT_EXISTS`, `429 REPORT_LIMIT`, `403 REPORT_OWN_LISTING`. */
export function reportListing(id: string, body: ListingReportRequest): Promise<ListingReportResult> {
  return data(api.post<ApiSuccess<ListingReportResult>>(`/listings/${id}/reports`, body));
}

// ─── Catalogue (public, A4) ───

/** GET /categories → the active tree (machine category › machine type › part group). */
export function fetchCategoryTree(): Promise<CategoryNode[]> {
  return data(api.get<ApiSuccess<CategoryNode[]>>('/categories'));
}

/** GET /categories/:id/template?kind= → the node's effective fields (part or machine). */
export function fetchTemplate(nodeId: string, kind: TemplateKind): Promise<EffectiveTemplate> {
  return data(api.get<ApiSuccess<EffectiveTemplate>>(`/categories/${nodeId}/template`, { params: { kind } }));
}

/** GET /brands?role=machines|parts&machineTypeId= (those with models of the type first). */
export function fetchBrands(params: { role?: 'machines' | 'parts'; machineTypeId?: string } = {}): Promise<Brand[]> {
  return data(api.get<ApiSuccess<Brand[]>>('/brands', { params }));
}

/** GET /models?brandId=&machineTypeId=. */
export function fetchModels(params: { brandId?: string; machineTypeId?: string } = {}): Promise<MachineModel[]> {
  return data(api.get<ApiSuccess<MachineModel[]>>('/models', { params }));
}

/** GET /master-data → active units and conditions. */
export function fetchMasterData(): Promise<MasterData> {
  return data(api.get<ApiSuccess<MasterData>>('/master-data'));
}

/** The template kind of a listing kind: rentals use the machine template. */
export function templateKindOf(kind: ListingKind): TemplateKind {
  return kind === 'part' ? 'part' : 'machine';
}
