'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ImageOff } from 'lucide-react';
import type { AdminListingDetail, EffectiveTemplate, ListingStatus } from '@mpm/shared-types';
import StatusBadge from '@/components/status-badge';
import { Panel } from '@/components/ui/panel';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { backLinkQuery, type BackTarget } from '@/lib/back-link';
import { ACCOUNT_STATUS_LABELS } from '@/lib/businesses-api';
import {
  FLAG_LABELS, KIND_LABELS, LISTING_CHANGED_MESSAGE, REVIEW_REASON_LABELS, SCORE_ITEM_LABELS, SIDE_LABELS,
  fetchAdminListing, fetchListingTemplate, formatRef,
} from '@/lib/listings-api';
import { classifyLoadError } from '@/lib/load-error';
import { LISTING_STATUS_LABELS } from '@/lib/status';
import { formatDate, formatDateTime } from '@/lib/utils';
import { ListingActions } from './listing-actions';
import { ListingMediaGrid } from './listing-media-grid';
import { Facts, ListingLocation, ListingSpecs } from './listing-specs';
import { ReportsPanel } from './reports-panel';
import { StatusHistory } from './status-history';

const LOAD_MESSAGES = {
  not_found: 'This listing does not exist.',
  forbidden: "Your role can't open listings.",
  failed: 'Check your connection and try again.',
};

const OUTCOME_WORDS = { approved: 'Approved', changes_requested: 'Changes asked for', rejected: 'Rejected' } as const;

const chip = (text: string, className = 'bg-gray-100 text-gray-700') => (
  <span key={text} className={`inline-flex h-6 items-center rounded-full px-[9px] text-[12.5px] font-semibold ${className}`}>{text}</span>
);

/**
 * One listing for a moderator (F2 spec §11.2), shared by `/moderation` and `/listings/[id]`: header, photos and videos
 * (full images), specs with the private fields, location, seller, reports, status history and the action bar.
 * `409 LISTING_CHANGED` (the seller edited while the moderator looked) shows a stale warning with Reload.
 */
export function ListingReview({ id, onChanged, onLoaded, from }: {
  id: string;
  /** Each time the listing is (re)loaded or changed, e.g. for the page title. */
  onLoaded?: (detail: AdminListingDetail) => void;
  /** After any change: the queue or table reloads. */
  onChanged?: () => void;
  /** Where the business link comes back to. */
  from?: BackTarget;
}) {
  const { hasRole } = useAuth();
  const canAct = hasRole('moderator');
  const [detail, setDetail] = useState<AdminListingDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stale, setStale] = useState(false);
  const [template, setTemplate] = useState<EffectiveTemplate | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchAdminListing(id);
      if (ticket !== latest.current) return;
      setDetail(next);
      setError(null);
      setStale(false);
    } catch (err) {
      if (ticket === latest.current) setError(err);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const loadedRef = useRef(onLoaded);
  loadedRef.current = onLoaded;
  useEffect(() => { if (detail) loadedRef.current?.(detail); }, [detail]);

  const categoryId = detail?.listing.id === id ? detail.listing.categoryId : null;
  const kind = detail?.listing.kind;
  // Spec labels are a nicety: without the template the keys show as words.
  useEffect(() => {
    if (!categoryId || !kind) return;
    let live = true;
    fetchListingTemplate(categoryId, kind)
      .then((t) => { if (live) setTemplate(t); })
      .catch(() => { if (live) setTemplate(null); });
    return () => { live = false; };
  }, [categoryId, kind]);

  const onResult = (next: AdminListingDetail) => {
    setDetail(next);
    setStale(false);
    onChanged?.();
  };
  const onConflict = (code: string) => {
    if (code === 'LISTING_CHANGED') setStale(true);
    else void load();
    onChanged?.();
  };

  const shown = detail?.listing.id === id ? detail : null;
  if (!shown) {
    return error ? (
      <ErrorState title="Couldn't open this listing" message={LOAD_MESSAGES[classifyLoadError(error)]} onRetry={() => void load()} />
    ) : (
      <div className="space-y-3 rounded-[20px] border border-gray-200 bg-white p-4" role="status" aria-label="Loading">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const l = shown.listing;
  const s = shown.seller;
  const back = from ?? { href: '/moderation/', label: 'Listing moderation' };
  const unaccepted = l.flags.filter((f) => !l.acceptedFlags.includes(f));
  const byStatus = Object.entries(s.listingsByStatus).filter(([, n]) => n && n > 0) as Array<[ListingStatus, number]>;

  return (
    <div className="space-y-4">
      {stale ? (
        <StaleWarning thing="listing" message={LISTING_CHANGED_MESSAGE} retryLabel="Reload" onRetry={() => void load()} />
      ) : error !== null && (
        <StaleWarning thing="listing" onRetry={() => void load()} />
      )}

      <div className="rounded-[20px] border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-photo">
            {l.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.thumbUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImageOff size={18} aria-hidden className="text-gray-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[19px] font-extrabold tracking-[-0.02em] text-gray-900">{l.title}</h2>
              <StatusBadge status={l.status} label={LISTING_STATUS_LABELS[l.status]} />
              {l.side && l.side !== 'not_applicable' && chip(SIDE_LABELS[l.side], 'bg-gray-900 text-white')}
            </div>
            <p className="mt-1 text-sm text-gray-600">
              <span className="font-mono">{formatRef(l.ref)}</span> · {KIND_LABELS[l.kind]} · {s.name}
              {l.city ? `, ${l.city}` : ''} · Updated <span className="tnum">{formatDateTime(l.updatedAt)}</span>
            </p>
            {l.reviewReasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Why it is in review">
                {l.reviewReasons.map((r) => chip(REVIEW_REASON_LABELS[r] ?? r, 'bg-sun text-sun-ink font-bold'))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-gray-600">
          <span>Listing score <b className="tnum text-gray-900">{l.score.score}</b>/100
            {l.score.missing.length > 0 && <> · missing {l.score.missing.map((m) => SCORE_ITEM_LABELS[m]).join(', ')}</>}
          </span>
          {unaccepted.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">Flags {unaccepted.map((f) => chip(FLAG_LABELS[f], 'bg-amber-50 text-amber-800'))}</span>
          )}
          {l.acceptedFlags.length > 0 && (
            <span>Accepted earlier: {l.acceptedFlags.map((f) => FLAG_LABELS[f]).join(', ')}</span>
          )}
          {l.returnStatus && <span>Returns to {LISTING_STATUS_LABELS[l.returnStatus]}</span>}
        </div>

        {l.moderation && (
          <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-800">
            {OUTCOME_WORDS[l.moderation.outcome]} on {formatDate(l.moderation.at)}{l.moderation.note ? `: ${l.moderation.note}` : '.'}
          </p>
        )}
        {l.statusReason && (l.status === 'hidden' || l.status === 'removed' || l.status === 'unavailable') && (
          <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-800">Reason: {l.statusReason}</p>
        )}

        <div className="mt-4 border-t border-gray-100 pt-3">
          <ListingActions detail={shown} onResult={onResult} onConflict={onConflict} />
        </div>
      </div>

      <Panel as="h3" title="Photos and videos">
        <ListingMediaGrid
          listingId={l.id}
          title={l.title}
          status={l.status}
          media={l.media}
          canDelete={canAct && l.status !== 'removed'}
          onDeleted={() => { void load(); onChanged?.(); }}
        />
      </Panel>

      <Panel as="h3" title="Details">
        <ListingSpecs detail={shown} template={template} />
      </Panel>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel as="h3" title="Location">
          <ListingLocation detail={shown} />
        </Panel>
        <Panel as="h3" title="Seller">
          <Facts
            rows={[
              ['Business', (
                <Link
                  key="b"
                  href={`/businesses/${s.businessId}/?${backLinkQuery(back.href, back.label)}`}
                  className="font-bold text-brand-700 hover:underline"
                >
                  {s.name}
                </Link>
              )],
              ['GST', s.gstVerified ? 'Verified' : 'Not verified'],
              ['Account', s.ownerStatus ? <StatusBadge key="a" status={s.ownerStatus} label={ACCOUNT_STATUS_LABELS[s.ownerStatus]} /> : '—'],
              ['Member since', formatDate(s.memberSince)],
              ['Listings', byStatus.length ? (
                <span key="ls" className="flex flex-wrap gap-1.5">
                  {byStatus.map(([status, n]) => chip(`${LISTING_STATUS_LABELS[status]} ${n}`))}
                </span>
              ) : 'None'],
              ['Ever went live', <span key="el" className="tnum">{s.everLive}</span>],
            ]}
          />
        </Panel>
      </div>

      <Panel as="h3" title={`Reports (${shown.reports.length})`}>
        <ReportsPanel detail={shown} canAct={canAct} onResult={onResult} onConflict={onConflict} />
      </Panel>

      <Panel as="h3" title="Status history">
        <StatusHistory history={shown.history} />
      </Panel>
    </div>
  );
}
