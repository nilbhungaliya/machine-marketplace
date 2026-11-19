import type { OfferView, OffersOptions } from '@mpm/shared-types';
import api from './api';
import { errorStatus } from './api-error';
import { newInstallId } from './install-id';
import type { OfferTermsBody, SendOfferBody } from './offer-form';

// Offers (F6 + F7 spec §7, §12.2): every write takes an `Idempotency-Key` (P11), one per tap, reused when the tap is
// retried after the answer was lost (no response).

/** A fresh `Idempotency-Key` (a random v4 uuid). */
export const newIdempotencyKey = (): string => newInstallId();

/**
 * Whether a failed write keeps its key for the next tap: only when no answer came back (the request may have landed,
 * so a retry with the same key replays it). Any answer — success or a refusal — ends the key.
 */
export function keepIdempotencyKey(err: unknown): boolean {
  return errorStatus(err) === undefined;
}

const headers = (key: string) => ({ headers: { 'Idempotency-Key': key } });

export async function fetchOffersOptions(): Promise<OffersOptions> {
  const { data } = await api.get<{ data: OffersOptions }>('/offers/options');
  return data.data;
}

export async function sendOffer(listingId: string, body: SendOfferBody, key: string): Promise<{ threadId: string; offer: OfferView }> {
  const { data } = await api.post<{ data: { threadId: string; offer: OfferView } }>(`/listings/${listingId}/offers`, body, headers(key));
  return data.data;
}

export async function sendQuote(threadId: string, body: OfferTermsBody, key: string): Promise<OfferView> {
  const { data } = await api.post<{ data: OfferView }>(`/threads/${threadId}/quote`, body, headers(key));
  return data.data;
}

export async function counterOffer(offerId: string, body: OfferTermsBody, key: string): Promise<OfferView> {
  const { data } = await api.post<{ data: OfferView }>(`/offers/${offerId}/counter`, body, headers(key));
  return data.data;
}

export async function acceptOffer(offerId: string, key: string): Promise<{ offer: OfferView; dealId: string }> {
  const { data } = await api.post<{ data: { offer: OfferView; dealId: string } }>(`/offers/${offerId}/accept`, {}, headers(key));
  return data.data;
}

export async function rejectOffer(offerId: string, note: string | null, key: string): Promise<OfferView> {
  const { data } = await api.post<{ data: OfferView }>(`/offers/${offerId}/reject`, note ? { note } : {}, headers(key));
  return data.data;
}

export async function withdrawOffer(offerId: string, key: string): Promise<OfferView> {
  const { data } = await api.post<{ data: OfferView }>(`/offers/${offerId}/withdraw`, {}, headers(key));
  return data.data;
}

export async function reconfirmOffer(offerId: string, key: string): Promise<OfferView> {
  const { data } = await api.post<{ data: OfferView }>(`/offers/${offerId}/reconfirm`, {}, headers(key));
  return data.data;
}
