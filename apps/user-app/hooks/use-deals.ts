import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DealView } from '@mpm/shared-types';
import { useIdempotencyKey } from '@/hooks/use-offers';
import { listingKeys } from '@/hooks/use-listing';
import { dealWrite, fetchDeal, fetchDeals, presignDealPhoto, type DealWriteBody } from '@/lib/deals-api';
import { preparePhoto, putFile } from '@/lib/media-device';
import { qk, type DealsSide, type DealsTab } from '@/lib/query-keys';

// Server state for deals (F6 + F7 spec §9): the Deals tab lists, the Deal record and every deal write. A write stores
// the returned `DealView` at once and refetches the lists, the thread (deal card, contact block), the badges and the
// listing (held quantity).

/** The Deals tab: one infinite list per tab × side. */
export function useDeals(tab: DealsTab, side: DealsSide) {
  return useInfiniteQuery({
    queryKey: qk.deals(tab, side),
    queryFn: ({ pageParam }) => fetchDeals({ tab, side, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** The Deal record. */
export function useDeal(id: string) {
  return useQuery({ queryKey: qk.deal(id), queryFn: () => fetchDeal(id) });
}

/** Every deal write, with its idempotency key held across a retried tap (P11). */
export function useDealWrite(dealId: string) {
  const qc = useQueryClient();
  const key = useIdempotencyKey();
  const refresh = (view: DealView | null) => {
    void qc.invalidateQueries({ queryKey: qk.allDeals });
    void qc.invalidateQueries({ queryKey: qk.badges() });
    if (view) {
      void qc.invalidateQueries({ queryKey: qk.thread(view.threadId) });
      void qc.invalidateQueries({ queryKey: listingKeys.detail(view.listingId) });
    }
  };
  return useMutation({
    mutationFn: (w: DealWriteBody) => dealWrite(dealId, w, key.take()),
    onSuccess: (view) => {
      key.settle();
      qc.setQueryData(qk.deal(dealId), view);
      refresh(view);
    },
    onError: (err) => {
      key.settle(err);
      // A refusal means the deal moved on (another member, a job): show what it is now.
      void qc.invalidateQueries({ queryKey: qk.deal(dealId) });
      refresh(qc.getQueryData<DealView>(qk.deal(dealId)) ?? null);
    },
  });
}

/**
 * One private photo for a deal (hand over, problem, §6.8): re-encoded on the phone (no EXIF / GPS), presigned and PUT;
 * returns the upload key the action sends. The server re-encodes it again when the action lands.
 */
export async function uploadDealPhoto(dealId: string, uri: string, size?: { width: number; height: number }): Promise<string> {
  const [full] = await preparePhoto(uri, size);
  if (!full) throw Object.assign(new Error('PHOTO_PREPARE_FAILED'), { code: 'PHOTO_PREPARE_FAILED' });
  const signed = await presignDealPhoto(dealId, { contentType: full.contentType, contentLength: full.size });
  await putFile(signed.url, full, () => {});
  return signed.key;
}
