import { useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { OfferView } from '@mpm/shared-types';
import { listingKeys } from '@/hooks/use-listing';
import { qk } from '@/lib/query-keys';
import {
  acceptOffer, counterOffer, fetchOffersOptions, keepIdempotencyKey, newIdempotencyKey, reconfirmOffer, rejectOffer,
  sendOffer, sendQuote, withdrawOffer,
} from '@/lib/offers-api';
import type { OfferTermsBody, SendOfferBody } from '@/lib/offer-form';

// Server state for offers (F6 + F7 spec §7): the validity choices, and every offer write. A write refetches the
// thread, its messages (the offer card), the inbox, the listing page (open negotiation, available quantity) and, after
// an accept, the deals.

/** `GET /offers/options`: validity choices and the open-offer limit. */
export function useOffersOptions(enabled = true) {
  return useQuery({ queryKey: qk.offersOptions(), queryFn: fetchOffersOptions, enabled, staleTime: 5 * 60 * 1000 });
}

/**
 * One `Idempotency-Key` per tap (P11): `take()` returns the key in hand or a new one; `settle(err?)` drops it after any
 * answer and keeps it when no answer came back, so a retried tap replays the lost request instead of repeating it.
 */
export function useIdempotencyKey() {
  const ref = useRef<string | null>(null);
  const take = useCallback(() => {
    if (!ref.current) ref.current = newIdempotencyKey();
    return ref.current;
  }, []);
  const settle = useCallback((err?: unknown) => {
    if (err === undefined || !keepIdempotencyKey(err)) ref.current = null;
  }, []);
  return { take, settle };
}

/** What an offer change makes stale. */
export function invalidateAfterOffer(qc: QueryClient, ids: { threadId?: string | null; listingId?: string | null; deal?: boolean }): void {
  if (ids.threadId) {
    void qc.invalidateQueries({ queryKey: qk.thread(ids.threadId) });
  }
  void qc.invalidateQueries({ queryKey: qk.allThreads });
  void qc.invalidateQueries({ queryKey: qk.badges() });
  void qc.invalidateQueries({ queryKey: qk.offersOptions() });
  if (ids.listingId) void qc.invalidateQueries({ queryKey: listingKeys.detail(ids.listingId) });
  if (ids.deal) void qc.invalidateQueries({ queryKey: qk.allDeals });
}

export type OfferWrite =
  | { type: 'send'; listingId: string; body: SendOfferBody }
  | { type: 'quote'; threadId: string; body: OfferTermsBody }
  | { type: 'counter'; offer: OfferView; body: OfferTermsBody }
  | { type: 'accept'; offer: OfferView }
  | { type: 'reject'; offer: OfferView; note: string | null }
  | { type: 'withdraw'; offer: OfferView }
  | { type: 'reconfirm'; offer: OfferView };

export interface OfferWriteResult {
  threadId: string;
  offer: OfferView;
  dealId: string | null;
}

async function runWrite(w: OfferWrite, key: string): Promise<OfferWriteResult> {
  switch (w.type) {
    case 'send': {
      const r = await sendOffer(w.listingId, w.body, key);
      return { threadId: r.threadId, offer: r.offer, dealId: null };
    }
    case 'quote': {
      const offer = await sendQuote(w.threadId, w.body, key);
      return { threadId: offer.threadId, offer, dealId: null };
    }
    case 'counter': {
      const offer = await counterOffer(w.offer.id, w.body, key);
      return { threadId: offer.threadId, offer, dealId: null };
    }
    case 'accept': {
      const r = await acceptOffer(w.offer.id, key);
      return { threadId: r.offer.threadId, offer: r.offer, dealId: r.dealId };
    }
    case 'reject': {
      const offer = await rejectOffer(w.offer.id, w.note, key);
      return { threadId: offer.threadId, offer, dealId: null };
    }
    case 'withdraw': {
      const offer = await withdrawOffer(w.offer.id, key);
      return { threadId: offer.threadId, offer, dealId: null };
    }
    case 'reconfirm': {
      const offer = await reconfirmOffer(w.offer.id, key);
      return { threadId: offer.threadId, offer, dealId: null };
    }
  }
}

const threadOf = (w: OfferWrite): string | null =>
  w.type === 'send' ? null : w.type === 'quote' ? w.threadId : w.offer.threadId;
const listingOf = (w: OfferWrite): string | null =>
  w.type === 'send' ? w.listingId : w.type === 'quote' ? null : w.offer.listingId;

/**
 * Every offer write, with its idempotency key held across a retried tap. Refusals (a 409 such as
 * `QUANTITY_NOT_AVAILABLE`, which also moved the offer to backup) refetch the thread too, so the card shows what
 * changed.
 */
export function useOfferWrite() {
  const qc = useQueryClient();
  const key = useIdempotencyKey();
  return useMutation({
    mutationFn: (w: OfferWrite) => runWrite(w, key.take()),
    onSuccess: (r, w) => {
      key.settle();
      invalidateAfterOffer(qc, { threadId: r.threadId, listingId: listingOf(w), deal: w.type === 'accept' });
    },
    onError: (err, w) => {
      key.settle(err);
      invalidateAfterOffer(qc, { threadId: threadOf(w), listingId: listingOf(w) });
    },
  });
}
