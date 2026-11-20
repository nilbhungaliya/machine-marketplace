'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Ban, Images } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminPartRequestDetail, Condition, EffectiveTemplate, SpecValue } from '@mpm/shared-types';
import { Facts } from '@/components/deals/facts';
import ImageLightbox from '@/components/image-lightbox';
import StatusBadge from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { useAuth } from '@/lib/auth-context';
import { backLinkQuery } from '@/lib/back-link';
import { fetchAdminMasterData } from '@/lib/catalog-api';
import { SIDE_LABELS, fetchListingTemplate, formatPaise } from '@/lib/listings-api';
import {
  AUDIENCE_LABELS, CLOSE_REASON_LABELS, DROP_REASON_LABELS, MATCH_TIER_LABELS, PART_REQUEST_KIND_LABELS,
  PART_REQUEST_STATUS_LABELS, REACH_LABELS, REPLY_STATUS_LABELS, dayAtNoon, fetchAdminPartRequestPhotos,
} from '@/lib/part-requests-api';
import type { StatusTone } from '@/lib/status';
import { formatDate, formatDateTime } from '@/lib/utils';
import { PartRequestReportList } from './part-request-reports';
import { TargetsTable } from './targets-table';

const REPLY_TONES: Record<AdminPartRequestDetail['replies'][number]['status'], StatusTone> = {
  pending: 'amber', delivered: 'green', withdrawn: 'gray', dropped: 'red',
};

const humanKey = (key: string) => {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** A spec value in words: option keys through the template's labels, lists joined. */
function specText(value: SpecValue, options: Map<string, string>): string {
  if (Array.isArray(value)) return value.map((v) => options.get(v) ?? v).join(', ');
  if (typeof value === 'string') return options.get(value) ?? value;
  return String(value);
}

/** A table on a record page: a heading row and one row per item, or a line when there are none. */
function RecordTable({ label, headers, rows, empty }: {
  label: string;
  headers: string[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-gray-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="min-w-full divide-y divide-gray-100 text-sm">
        <thead>
          <tr>
            {headers.map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.key} className="align-top">
              {r.cells.map((c, i) => <td key={i} className="px-3 py-2">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One requirement for staff (F8 spec §14; textile `requirement-detail.tsx`): the fields as sellers see them plus the
 * budget (shown or private) and audience, the masked note, reference photos (300 s URLs fetched on open), the buyer and
 * reach (sellers told, eligible now), the sellers told, every reply and auto match, and its reports. The name, note and
 * reply messages arrive masked from the API.
 */
export function PartRequestDetail({ detail, onChanged }: {
  detail: AdminPartRequestDetail;
  /** After a report is resolved: reload. */
  onChanged: () => void;
}) {
  const r = detail;
  const { hasRole } = useAuth();
  // The nav's roles for each linked page.
  const canOpenBusinesses = hasRole('support', 'verification_officer', 'moderator');
  const canOpenListings = hasRole('moderator', 'support');
  const canOpenDeals = hasRole('support', 'operations');
  const backHere = backLinkQuery(`/part-requests/${r.id}/`, r.name);

  const [template, setTemplate] = useState<EffectiveTemplate | null>(null);
  const [conditions, setConditions] = useState<Condition[] | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  // Spec and condition labels are a nicety: without them keys show as words and conditions as a count.
  useEffect(() => {
    let live = true;
    fetchListingTemplate(r.categoryId, r.kind).then((t) => { if (live) setTemplate(t); }).catch(() => {});
    return () => { live = false; };
  }, [r.categoryId, r.kind]);
  useEffect(() => {
    let live = true;
    fetchAdminMasterData().then((m) => { if (live) setConditions(m.conditions); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const openPhotos = async () => {
    setLoadingPhotos(true);
    try {
      // Fresh URLs every time: they last 300 s.
      const { photos: signed } = await fetchAdminPartRequestPhotos(r.id);
      setPhotos(signed.map((p) => p.url));
      if (signed.length) setPhotoIndex(0);
      else toast.error('This requirement has no photos any more');
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Could not load the photos');
    } finally {
      setLoadingPhotos(false);
    }
  };

  const fields = new Map((template?.fields ?? []).map((f) => [f.key, f]));
  const specRows: Array<[string, ReactNode]> = Object.entries(r.specs).map(([key, value]) => {
    const field = fields.get(key);
    const options = new Map((field?.options ?? []).map((o) => [o.key, o.label]));
    const unit = field?.unit ? ` ${field.unit}` : '';
    return [field?.label ?? humanKey(key), `${specText(value, options)}${unit}`];
  });

  const conditionText = r.conditionIds.length === 0
    ? 'Any condition'
    : conditions
      ? r.conditionIds.map((id) => conditions.find((c) => c.id === id)?.label ?? 'Unknown').join(', ')
      : `${r.conditionIds.length} accepted`;

  const unitWord = r.unit.label.toLowerCase().replace(/s$/, '') || 'unit';
  const budget: ReactNode = r.budgetPerUnitPaise != null ? (
    <span>
      <span className="tnum">{formatPaise(r.budgetPerUnitPaise)}</span> per {unitWord}{' '}
      <span className="font-normal text-gray-500">({r.budgetVisible ? 'shown to sellers' : 'private: sellers don’t see it'})</span>
    </span>
  ) : 'Not given';

  const fits: ReactNode = r.fits.length ? (
    <ul className="space-y-1">
      {r.fits.map((f, i) => {
        const years = f.yearFrom || f.yearTo ? ` (${f.yearFrom ?? '…'}–${f.yearTo ?? '…'})` : '';
        return (
          <li key={`${f.brandId}-${f.modelId ?? ''}-${i}`}>
            {f.brandName} {f.modelName ?? <span className="font-normal text-gray-500">all models</span>}
            {years && <span className="tnum">{years}</span>}
          </li>
        );
      })}
    </ul>
  ) : 'Not given';

  const removed = r.status === 'removed';
  const active = r.status === 'active';

  return (
    <div className="space-y-4">
      {removed && (
        <p role="status" className="flex items-start gap-2.5 rounded-xl bg-red-50 px-3 py-2.5 text-[13.5px] leading-[1.45] text-red-600">
          <Ban size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Removed by the team
            {r.removedAt && <>, <span className="tnum">{formatDateTime(r.removedAt)}</span></>}
            {r.removedReason && <>: {r.removedReason}</>}
            {r.returnStatus && <> Restoring returns it to {PART_REQUEST_STATUS_LABELS[r.returnStatus].toLowerCase()}.</>}
          </span>
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Requirement">
            <Facts
              rows={[
                ['Category', r.categoryPath.length ? r.categoryPath.map((c) => c.name).join(' › ') : '—'],
                ['Kind', PART_REQUEST_KIND_LABELS[r.kind]],
                ['Name', r.name],
                ...(r.kind === 'part' ? [
                  ['Part number', r.partNumber ? <span key="pn" className="font-mono text-[13px]">{r.partNumber}</span> : '—'] as [string, ReactNode],
                  ['Side', r.side ? SIDE_LABELS[r.side] : '—'] as [string, ReactNode],
                ] : []),
                ['Fits', fits],
                ['Quantity', <span key="q" className="tnum">{r.quantity} {r.unit.label}</span>],
                ['Condition', conditionText],
                ['Budget', budget],
                ['Needed by', r.neededBy ? <span key="nb" className="tnum">{formatDate(dayAtNoon(r.neededBy))}</span> : 'Not given'],
                ['Urgent', r.urgent ? 'Yes' : 'No'],
                ['Reach', REACH_LABELS[r.reach]],
                ['Audience', AUDIENCE_LABELS[r.audience]],
                ['Place', [r.city, r.state].filter(Boolean).join(', ') || '—'],
                ['Validity', `${r.validityDays} days`],
                ['Expires', (
                  <span key="ex" className="tnum">
                    {formatDateTime(r.expiresAt)}{active && ` (${r.daysLeft} ${r.daysLeft === 1 ? 'day' : 'days'} left)`}
                  </span>
                )],
                ['Renewable until', <span key="ru" className="tnum">{formatDate(r.renewableUntil)}</span>],
                ['First posted', <span key="fp" className="tnum">{formatDateTime(r.firstPostedAt)}</span>],
                ['Close reason', r.closeReason ? CLOSE_REASON_LABELS[r.closeReason] : '—'],
                ['Fulfilled with', r.fulfilledDealId
                  ? canOpenDeals
                    ? <Link key="fd" href={`/deals/${r.fulfilledDealId}/?${backHere}`} className="text-brand-700 hover:underline">The deal</Link>
                    : 'A deal on the platform'
                  : '—'],
              ]}
            />
            {specRows.length > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <h3 className="mb-2 text-xs font-bold text-gray-600">Specifications</h3>
                <Facts rows={specRows} />
              </div>
            )}
            {r.note && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-gray-600">
                  Note
                  {r.noteFlagged && <span className="rounded-full bg-amber-50 px-2 py-px text-[11px] font-bold text-amber-600">Flagged: contact details masked</span>}
                </h3>
                <p className="whitespace-pre-line text-sm text-gray-900 [overflow-wrap:anywhere]">{r.note}</p>
              </div>
            )}
            {r.photoCount > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <Button size="sm" variant="secondary" loading={loadingPhotos} onClick={() => void openPhotos()}>
                  <Images size={14} aria-hidden /> View {r.photoCount === 1 ? 'the photo' : `${r.photoCount} photos`}
                </Button>
                <ImageLightbox
                  urls={photos}
                  index={photoIndex}
                  onIndex={setPhotoIndex}
                  onClose={() => setPhotoIndex(null)}
                  label="Reference photo"
                />
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Buyer">
            <Facts
              rows={[
                ['Business', canOpenBusinesses
                  ? <Link key="b" href={`/businesses/${r.buyer.businessId}/?${backHere}`} className="text-brand-700 hover:underline">{r.buyer.name}</Link>
                  : r.buyer.name],
              ]}
            />
          </Panel>
          <Panel title="Reach">
            <Facts
              rows={[
                ['Sellers told', <span key="t" className="tnum">{r.targetedCount}</span>],
                ['Eligible now', <span key="e" className="tnum">{r.eligibleNow}</span>],
                ['Replies', <span key="r" className="tnum">{r.counts.replies}{r.counts.newReplies > 0 && ` (${r.counts.newReplies} unseen by the buyer)`}</span>],
                ['Matches', <span key="m" className="tnum">{r.counts.matches}{r.counts.newMatches > 0 && ` (${r.counts.newMatches} unseen by the buyer)`}</span>],
                ['Matched', r.matched ? 'Yes' : 'No'],
              ]}
            />
            <p className="mt-3 text-[13px] text-gray-500">
              {active
                ? 'Eligible now: every seller business that can see it and reply today.'
                : 'Eligible now: not active, so no seller can see it or reply.'}
            </p>
          </Panel>
        </div>
      </div>

      <Panel title={`Sellers told (${r.targets.length})`}>
        <TargetsTable targets={r.targets} canOpenBusinesses={canOpenBusinesses} />
      </Panel>

      <Panel title={`Replies (${r.replies.length})`}>
        <RecordTable
          label="Replies"
          empty="No replies yet."
          headers={['Listing', 'Seller', 'Status', 'Message', 'Sent']}
          rows={r.replies.map((reply) => ({
            key: reply.id,
            cells: [
              canOpenListings
                ? <Link href={`/listings/${reply.listingId}/?${backHere}`} className="font-semibold text-brand-700 hover:underline">{reply.listingTitle || 'Listing'}</Link>
                : <span className="font-semibold text-gray-900">{reply.listingTitle || 'Listing'}</span>,
              canOpenBusinesses
                ? <Link href={`/businesses/${reply.seller.businessId}/`} className="text-brand-700 hover:underline">{reply.seller.name}</Link>
                : reply.seller.name,
              <span key="s" className="block">
                <StatusBadge status={reply.status} label={REPLY_STATUS_LABELS[reply.status]} tone={REPLY_TONES[reply.status]} />
                {reply.dropReason && <span className="mt-1 block text-[12.5px] text-gray-600">{DROP_REASON_LABELS[reply.dropReason]}</span>}
              </span>,
              reply.message
                ? <span className="block max-w-[22rem] whitespace-pre-wrap text-gray-900 [overflow-wrap:anywhere]">{reply.message}</span>
                : <span className="text-gray-500">—</span>,
              <span key="c" className="tnum">{formatDateTime(reply.createdAt)}</span>,
            ],
          }))}
        />
      </Panel>

      <Panel title={`Matches (${r.matches.length})`}>
        <RecordTable
          label="Matches"
          empty="No listing has matched yet."
          headers={['Listing', 'Seller', 'Matched on', 'Distance', 'Pushed', 'Found']}
          rows={r.matches.map((m) => ({
            key: m.listingId,
            cells: [
              canOpenListings
                ? <Link href={`/listings/${m.listingId}/?${backHere}`} className="font-semibold text-brand-700 hover:underline">{m.listingTitle || 'Listing'}</Link>
                : <span className="font-semibold text-gray-900">{m.listingTitle || 'Listing'}</span>,
              canOpenBusinesses
                ? <Link href={`/businesses/${m.seller.businessId}/`} className="text-brand-700 hover:underline">{m.seller.name}</Link>
                : m.seller.name,
              MATCH_TIER_LABELS[m.tier],
              <span key="d" className="tnum">{m.distanceKm === null ? '—' : `${m.distanceKm} km`}</span>,
              m.pushed ? 'Yes' : <span key="p" className="text-gray-500">No</span>,
              <span key="f" className="tnum">{formatDateTime(m.createdAt)}</span>,
            ],
          }))}
        />
      </Panel>

      <Panel title={`Reports (${r.reports.length})`}>
        {r.reports.length === 0
          ? <p className="text-sm text-gray-500">No reports on this requirement.</p>
          : <PartRequestReportList reports={r.reports} showRequest={false} onChanged={onChanged} />}
      </Panel>
    </div>
  );
}
