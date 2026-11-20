import type {
  CompareColumn,
  MyPartRequestTab,
  MyPartRequestsPage,
  PartRequestBuyerView,
  PartRequestCloseReason,
  PartRequestDemand,
  PartRequestFeedbackReason,
  PartRequestHome,
  PartRequestInput,
  PartRequestKind,
  PartRequestMatchItem,
  PartRequestOptions,
  PartRequestPatch,
  PartRequestPhotos,
  PartRequestReplyItem,
  PartRequestReportReason,
  PartRequestView,
  ReplyOptionsResponse,
  SellerPartRequestTab,
  SellerPartRequestsPage,
  SellerReplyView,
  SendRepliesRequest,
} from '@mpm/shared-types';
import api from './api';

// One typed function per part-request route (F8 spec §12.2). Every write takes an `Idempotency-Key` the caller makes
// once per tap and reuses on retry (`newIdempotencyKey` in `lib/offers-api.ts`). Errors are axios errors: map them
// with `lib/f8-errors.ts`.

const headers = (key: string) => ({ headers: { 'Idempotency-Key': key } });
const data = <T>(p: Promise<{ data: { data: T } }>): Promise<T> => p.then((r) => r.data.data);

// ─── Buyer: post and manage ───

/** Public: settings for a guest; the business's open count, limit and posts left today when signed in. */
export function fetchPartRequestOptions(): Promise<PartRequestOptions> {
  return data(api.get('/part-requests/options'));
}

/** A private reference photo upload (chat's pipeline): PUT the bytes to `url`, then send `key` in `photoKeys`. */
export function presignPartRequestPhoto(contentType: string, contentLength: number): Promise<{ url: string; key: string; expiresAt: string }> {
  return data(api.post('/part-requests/photos/presign', { contentType, contentLength }));
}

export function createPartRequest(input: PartRequestInput, key: string): Promise<PartRequestBuyerView> {
  return data(api.post('/part-requests', input, headers(key)));
}

export function updatePartRequest(id: string, patch: PartRequestPatch, key: string): Promise<PartRequestBuyerView> {
  return data(api.patch(`/part-requests/${id}`, patch, headers(key)));
}

export function renewPartRequest(id: string, days: number, key: string): Promise<PartRequestBuyerView> {
  return data(api.post(`/part-requests/${id}/renew`, { days }, headers(key)));
}

export function closePartRequest(id: string, reason: PartRequestCloseReason, key: string): Promise<PartRequestBuyerView> {
  return data(api.post(`/part-requests/${id}/close`, { reason }, headers(key)));
}

export function fulfilPartRequest(id: string, dealId: string | null, key: string): Promise<PartRequestBuyerView> {
  return data(api.post(`/part-requests/${id}/fulfil`, dealId ? { dealId } : {}, headers(key)));
}

/** The buyer opened the page: grouped notifications read, delivered replies seen. */
export function markPartRequestRead(id: string): Promise<{ ok: true }> {
  return data(api.post(`/part-requests/${id}/read`, {}));
}

export function fetchMyPartRequests(status: MyPartRequestTab, cursor?: string | null): Promise<MyPartRequestsPage> {
  return data(api.get('/part-requests/mine', { params: cursor ? { status, cursor } : { status } }));
}

export function fetchPartRequestHome(): Promise<PartRequestHome> {
  return data(api.get('/part-requests/home'));
}

// ─── Either side ───

/** `{ role: 'buyer' }` for the posting business, `{ role: 'seller' }` for an eligible seller; 404 otherwise. */
export function fetchPartRequest(id: string): Promise<PartRequestView> {
  return data(api.get(`/part-requests/${id}`));
}

export function fetchPartRequestPhotos(id: string): Promise<PartRequestPhotos> {
  return data(api.get(`/part-requests/${id}/photos`));
}

// ─── Buyer: responses ───

export function fetchPartRequestReplies(id: string): Promise<{ items: PartRequestReplyItem[] }> {
  return data(api.get(`/part-requests/${id}/replies`));
}

export function fetchPartRequestMatches(id: string): Promise<{ items: PartRequestMatchItem[] }> {
  return data(api.get(`/part-requests/${id}/matches`));
}

export function fetchPartRequestCompare(id: string): Promise<{ columns: CompareColumn[] }> {
  return data(api.get(`/part-requests/${id}/compare`));
}

// ─── Seller ───

export function fetchPartRequestsForSellers(input: {
  tab: SellerPartRequestTab;
  kind?: PartRequestKind | null;
  forListing?: string | null;
  cursor?: string | null;
}): Promise<SellerPartRequestsPage> {
  const params: Record<string, string> = { tab: input.tab };
  if (input.kind) params.kind = input.kind;
  if (input.forListing) params.forListing = input.forListing;
  if (input.cursor) params.cursor = input.cursor;
  return data(api.get('/part-requests/for-sellers', { params }));
}

export function fetchReplyOptions(id: string): Promise<ReplyOptionsResponse> {
  return data(api.get(`/part-requests/${id}/reply-options`));
}

export function sendReplies(id: string, body: SendRepliesRequest, key: string): Promise<{ replies: SellerReplyView[] }> {
  return data(api.post(`/part-requests/${id}/replies`, body, headers(key)));
}

export function withdrawReply(id: string, replyId: string, key: string): Promise<SellerReplyView> {
  return data(api.post(`/part-requests/${id}/replies/${replyId}/withdraw`, {}, headers(key)));
}

export function markNotRelevant(id: string, reason: PartRequestFeedbackReason | null): Promise<{ notRelevant: boolean }> {
  return data(api.post(`/part-requests/${id}/not-relevant`, reason ? { reason } : {}));
}

export function undoNotRelevant(id: string): Promise<{ notRelevant: boolean }> {
  return data(api.delete(`/part-requests/${id}/not-relevant`));
}

export function reportPartRequest(id: string, reason: PartRequestReportReason, details?: string | null): Promise<{ reported: true }> {
  return data(api.post(`/part-requests/${id}/report`, details ? { reason, details } : { reason }));
}

/** The owner's listing: active requests it could answer ("Buyers are looking for this"). */
export function fetchDemand(listingId: string): Promise<PartRequestDemand> {
  return data(api.get(`/listings/${listingId}/part-request-demand`));
}
