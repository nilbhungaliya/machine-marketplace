import type { DealFulfilment, DealPaymentMethod, DealView, DealsPage, DisputeCategory } from '@mpm/shared-types';
import api from './api';
import type { DealsSide, DealsTab } from './query-keys';

// Deals (F6 + F7 spec §9, §12.2). Every write takes an `Idempotency-Key` (P11, `lib/offers-api.ts`) and answers the
// reader's fresh `DealView`.

const headers = (key: string) => ({ headers: { 'Idempotency-Key': key } });

export async function fetchDeals(input: { tab: DealsTab; side: DealsSide; cursor?: string | null }): Promise<DealsPage> {
  const params: Record<string, string> = { tab: input.tab, side: input.side };
  if (input.cursor) params.cursor = input.cursor;
  const { data } = await api.get<{ data: DealsPage }>('/deals', { params });
  return data.data;
}

export async function fetchDeal(id: string): Promise<DealView> {
  const { data } = await api.get<{ data: DealView }>(`/deals/${id}`);
  return data.data;
}

/** `PATCH /deals/:id/notes`: only the fields sent change; `version` guards against a stale edit (`409 DEAL_STALE`). */
export interface DealNotesPatch {
  version: number;
  paymentMethod?: DealPaymentMethod | null;
  /** Paise as a decimal string (P4). */
  advancePaise?: string | null;
  fulfilment?: DealFulfilment | null;
  /** `YYYY-MM-DD`. */
  expectedOn?: string | null;
  text?: string | null;
}

export type DealWriteBody =
  | { action: 'notes'; body: DealNotesPatch }
  | { action: 'hand_over'; body: { photoKey?: string; note?: string | null } }
  | { action: 'confirm_received' }
  | { action: 'cancel'; body: { reason: string; note?: string | null } }
  | { action: 'request_cancel'; body: { reason?: string } }
  | { action: 'accept_cancel_request' }
  | { action: 'clear_cancel_request' }
  | { action: 'problem'; body: { category: DisputeCategory; description: string; photoKeys?: string[] } };

export async function dealWrite(dealId: string, w: DealWriteBody, key: string): Promise<DealView> {
  const h = headers(key);
  const path = (p: string) => `/deals/${dealId}${p}`;
  let res;
  switch (w.action) {
    case 'notes': res = await api.patch<{ data: DealView }>(path('/notes'), w.body, h); break;
    case 'hand_over': res = await api.post<{ data: DealView }>(path('/hand-over'), w.body, h); break;
    case 'confirm_received': res = await api.post<{ data: DealView }>(path('/confirm-received'), {}, h); break;
    case 'cancel': res = await api.post<{ data: DealView }>(path('/cancel'), w.body, h); break;
    case 'request_cancel': res = await api.post<{ data: DealView }>(path('/cancel-request'), w.body, h); break;
    case 'accept_cancel_request': res = await api.post<{ data: DealView }>(path('/cancel-request/accept'), {}, h); break;
    case 'clear_cancel_request': res = await api.post<{ data: DealView }>(path('/cancel-request/clear'), {}, h); break;
    case 'problem': res = await api.post<{ data: DealView }>(path('/problem'), w.body, h); break;
  }
  return res.data.data;
}

/** `POST /deals/:id/photos/presign`: a signed PUT for one private photo (§6.8). */
export async function presignDealPhoto(dealId: string, body: { contentType: string; contentLength: number }):
  Promise<{ url: string; key: string; expiresAt: string }> {
  const { data } = await api.post<{ data: { url: string; key: string; expiresAt: string } }>(`/deals/${dealId}/photos/presign`, body);
  return data.data;
}
