'use client';

import { useState } from 'react';
import { ImageOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ListingMediaItem, ListingStatus } from '@mpm/shared-types';
import ImageLightbox from '@/components/image-lightbox';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { deleteListingMedia, explainListingError, PURGE_FAILED_MESSAGE } from '@/lib/listings-api';

/** Statuses a last-photo delete sends back to the seller as `rejected` (R52). */
const PHOTOS_REMOVED_FROM: readonly ListingStatus[] = ['live', 'paused', 'expired', 'unavailable', 'sold', 'rented'];

const seconds = (ms: number | null) => (ms == null ? '' : `${Math.round(ms / 1000)} s`);

/**
 * Photos and videos on the review screen (F2 spec §11.2): photo thumbnails open the **full** image in the lightbox (a
 * moderator must see detail); videos play inline with their poster. Moderators can delete one item with a reason; the
 * objects are deleted and the CDN purged after commit, and a failed purge is said so.
 */
export function ListingMediaGrid({ listingId, title, status, media, canDelete, onDeleted }: {
  listingId: string;
  title: string;
  status: ListingStatus;
  media: ListingMediaItem[];
  canDelete: boolean;
  /** After a delete: the page reloads the listing (its status may have changed). */
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<{ item: ListingMediaItem; label: string } | null>(null);
  const photos = media.filter((m) => m.type === 'photo');
  const videos = media.filter((m) => m.type === 'video');
  const fullUrls = photos.map((p) => p.url ?? p.thumbUrl ?? '');

  if (media.length === 0) {
    return <p className="text-sm font-semibold text-amber-800">No photos or videos. This listing can&apos;t go live without a photo.</p>;
  }

  const lastPhoto = deleting?.item.type === 'photo' && photos.length === 1;

  return (
    <div className="space-y-4">
      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
          {photos.map((p, i) => (
            <li key={p.id} className="group relative aspect-square overflow-hidden rounded-xl border border-gray-200 bg-photo">
              <button
                type="button"
                aria-label={`Open photo ${i + 1}`}
                onClick={() => setOpen(i)}
                className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600"
              >
                {p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageOff size={18} aria-hidden className="mx-auto text-gray-400" />
                )}
              </button>
              {i === 0 && (
                <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-gray-700">Cover</span>
              )}
              {canDelete && (
                <button
                  type="button"
                  aria-label={`Delete photo ${i + 1}`}
                  onClick={() => setDeleting({ item: p, label: `photo ${i + 1}` })}
                  className="absolute right-1.5 top-1.5 rounded-full bg-white p-1.5 text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {videos.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {videos.map((v, i) => (
            <li key={v.id} className="overflow-hidden rounded-xl border border-gray-200">
              {v.url ? (
                <video controls preload="none" poster={v.thumbUrl ?? undefined} src={v.url} className="aspect-video w-full bg-gray-900">
                  <track kind="captions" />
                </video>
              ) : (
                <p className="p-3 text-sm text-gray-500">Media storage isn&apos;t set up: the video can&apos;t be played here.</p>
              )}
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-[13px] text-gray-600">
                <span>Video {i + 1}<span className="tnum"> · {seconds(v.durationMs)}</span></span>
                {canDelete && (
                  <button
                    type="button"
                    aria-label={`Delete video ${i + 1}`}
                    onClick={() => setDeleting({ item: v, label: `video ${i + 1}` })}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-bold text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={13} aria-hidden /> Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ImageLightbox
        urls={fullUrls}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
        label={open === null ? undefined : `${title}, photo ${open + 1}`}
      />

      {deleting && (
        <ReasonDialog
          title={`Delete ${deleting.label}`}
          description="For abusive or misleading media. The seller sees the reason."
          submitLabel="Delete"
          submitVariant="danger"
          onClose={() => setDeleting(null)}
          onSubmit={async (reason) => {
            try {
              const { purge } = await deleteListingMedia(listingId, deleting.item.id, reason);
              toast.success(purge === 'failed' ? PURGE_FAILED_MESSAGE : 'Deleted');
              onDeleted();
              return true;
            } catch (err) {
              toast.error(explainListingError(err, 'Could not delete it'));
              return false;
            }
          }}
        >
          {lastPhoto && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This is the last photo.{' '}
              {PHOTOS_REMOVED_FROM.includes(status)
                ? 'The listing goes back to the seller as rejected, with your reason, until they add a photo.'
                : "The listing can't be approved or unhidden until the seller adds one."}
            </p>
          )}
        </ReasonDialog>
      )}
    </div>
  );
}
