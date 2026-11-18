import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ListingMediaItem, ListingOwnerView, MediaType } from '@mpm/shared-types';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS } from '@/lib/analytics-events';
import { listingUploadIO } from '@/lib/media-device';
import {
  nextToUpload, pendingCount, runUpload, uploadReducer, type NewUploadItem, type UploadIO,
} from '@/lib/media-upload';
import { invalidateListingLists, listingKeys } from './use-listing';

/**
 * The media step's upload queue (§6.2) for one listing: add prepared items, and they upload one at a time; a failed
 * item stays with its error code until `retry` (a re-presign with the same `uploadId`) or `remove`. Each attached item
 * is appended to the owner view's `media` in the cache, then dropped from the queue; My listings (drafts too), the
 * public page and the seller / Other side lists are marked stale. Tracks `sell_media_upload_failed { type, code }`.
 * `io` is injectable for a dev screen.
 *
 * **The queue lives in the component.** On unmount, queued and failed items are dropped and an upload in flight is
 * finished but no longer reported (its attach still lands on the server and shows on the next owner-view fetch). So
 * the caller keeps the seller on the media step while `busy`: Next / Back / the hardware back are held, or leaving asks
 * first (`useConfirm`, "Uploads in progress will stop"). Status mapping for `MediaTile`: `queued` → `queued`,
 * `uploading` and `attaching` → `uploading` (attaching shows a full bar), `failed` → `failed` (`tileState()` in `lib/media-upload.ts`).
 */
export function useUploadQueue(listingId: string, io?: UploadIO) {
  const qc = useQueryClient();
  const [items, dispatch] = useReducer(uploadReducer, []);
  const ioRef = useRef<UploadIO>(io ?? listingUploadIO(listingId));
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const safeDispatch = useCallback((a: Parameters<typeof dispatch>[0]) => { if (mounted.current) dispatch(a); }, []);

  const next = nextToUpload(items);
  useEffect(() => {
    if (!next) return;
    void runUpload(next, ioRef.current, safeDispatch).then((res) => {
      if (res.ok) {
        qc.setQueryData<ListingOwnerView>(listingKeys.owner(listingId), (prev) =>
          prev ? { ...prev, media: appendMedia(prev.media, res.media) } : prev);
        void qc.invalidateQueries({ queryKey: listingKeys.owner(listingId) });
        const owner = qc.getQueryData<ListingOwnerView>(listingKeys.owner(listingId));
        invalidateListingLists(qc, listingId, owner?.businessId);
        safeDispatch({ type: 'remove', localId: next.localId });
      } else {
        track(LISTING_EVENTS.sellMediaUploadFailed, { type: next.type, code: res.code });
      }
    });
    // Starts each item once: `next` changes identity only when the queue moves on.
  }, [next?.localId, next?.attempts]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => ({
    items,
    add: (newItems: NewUploadItem[]) => dispatch({ type: 'add', items: newItems }),
    retry: (localId: string) => dispatch({ type: 'retry', localId }),
    remove: (localId: string) => dispatch({ type: 'remove', localId }),
    /** Items of a type still taking a slot (count them with `remainingSlots`). */
    pending: (type: MediaType) => pendingCount(items, type),
    busy: items.some((i) => i.status === 'queued' || i.status === 'uploading' || i.status === 'attaching'),
  }), [items]);
}

function appendMedia(media: ListingMediaItem[], item: ListingMediaItem): ListingMediaItem[] {
  return media.some((m) => m.id === item.id) ? media : [...media, item];
}
