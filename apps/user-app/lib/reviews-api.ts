import type { DealView, PublicReview, ReviewReportReason, ReviewState, SellerReviewsPage } from '@mpm/shared-types';
import api from '@/lib/api';

// Reviews (F6 + F7 spec §10, §12.2). Thin calls; the screens hold the rules (`lib/review-form.ts`).

/** `GET /deals/:id/review`: who may review, mine, whether theirs is in, when the first publishes. */
export async function fetchReviewState(dealId: string): Promise<ReviewState> {
  const { data } = await api.get<{ data: ReviewState }>(`/deals/${dealId}/review`);
  return data.data;
}

/** `GET /deals/:id`: the deal the review is about (shared with the Deal record's cache key). */
export async function fetchDealForReview(dealId: string): Promise<DealView> {
  const { data } = await api.get<{ data: DealView }>(`/deals/${dealId}`);
  return data.data;
}

/** `POST /deals/:id/review` (**I**): one key per tap, reused on retry. */
export async function submitReview(
  dealId: string,
  body: { ratings: Record<string, number>; text?: string },
  idempotencyKey: string,
): Promise<ReviewState> {
  const { data } = await api.post<{ data: ReviewState }>(`/deals/${dealId}/review`, body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data.data;
}

/** `GET /businesses/:id/reviews` (public, guests too). */
export async function fetchSellerReviews(businessId: string, cursor?: string | null): Promise<SellerReviewsPage> {
  const { data } = await api.get<{ data: SellerReviewsPage }>(`/businesses/${businessId}/reviews`, {
    params: cursor ? { cursor } : undefined,
  });
  return data.data;
}

/** `GET /users/me/reviews`: my seller score and the reviews my business received. */
export async function fetchMyReviews(cursor?: string | null): Promise<SellerReviewsPage> {
  const { data } = await api.get<{ data: SellerReviewsPage }>('/users/me/reviews', { params: cursor ? { cursor } : undefined });
  return data.data;
}

/** `POST /reviews/:id/reply` (**I**): once, ≤ 300. */
export async function replyToReview(reviewId: string, text: string, idempotencyKey: string): Promise<PublicReview> {
  const { data } = await api.post<{ data: PublicReview }>(`/reviews/${reviewId}/reply`, { text }, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data.data;
}

/** `POST /reviews/:id/report`. */
export async function reportReview(reviewId: string, body: { reason: ReviewReportReason; details?: string }): Promise<void> {
  await api.post(`/reviews/${reviewId}/report`, body);
}
