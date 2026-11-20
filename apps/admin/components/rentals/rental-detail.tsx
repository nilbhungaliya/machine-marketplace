'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import {
  RENTAL_DISPUTE_CATEGORIES, type AdminRentalBookingDetail, type DisputeOutcome, type RentalCancelReason,
  type RentalDeclineReason, type RentalFinalReason, type RentalPeriod, type RentalVersionView,
} from '@mpm/shared-types';
import { Facts, PartyName } from '@/components/deals/facts';
import ImageLightbox from '@/components/image-lightbox';
import StatusBadge from '@/components/status-badge';
import { Panel } from '@/components/ui/panel';
import { useAuth } from '@/lib/auth-context';
import { PAYMENT_METHOD_LABELS } from '@/lib/deals-api';
import {
  DISPUTE_CATEGORY_LABELS, DISPUTE_OUTCOME_SHORT, DISPUTE_STATUS_LABELS, DISPUTE_STATUS_TONES,
} from '@/lib/disputes-api';
import {
  FUEL_LABELS, OPERATOR_LABELS, RENTAL_PERIOD_LABELS, TRANSPORT_LABELS, formatPaise,
} from '@/lib/listings-api';
import {
  RENTAL_ACTOR_LABELS, RENTAL_CANCEL_REASON_LABELS, RENTAL_COMPLETED_HOW_LABELS, RENTAL_DECLINE_REASON_LABELS,
  RENTAL_EVENT_LABELS, RENTAL_FINAL_REASON_LABELS, RENTAL_PERIOD_WORDS, RENTAL_TURN_LABELS, formatBookingRef,
  formatDayRange,
} from '@/lib/rentals-api';
import { RENTAL_BOOKING_STATUS_LABELS, rentalBookingStatusTone } from '@/lib/status';
import { formatDateTime } from '@/lib/utils';

const when = (iso: string | null) => (iso ? <span className="tnum">{formatDateTime(iso)}</span> : '—');
const RATE_KEY = { hour: 'rateHourPaise', day: 'rateDayPaise', week: 'rateWeekPaise', month: 'rateMonthPaise' } as const;
const yesNo = (v: boolean | null) => (v === null ? '—' : v ? 'Yes' : 'No');

/** "3 days" / "1 week". */
export function periodWords(period: RentalPeriod, count: number): string {
  const [one, many] = RENTAL_PERIOD_WORDS[period];
  return `${count} ${count === 1 ? one : many}`;
}

/** A masked text a party typed, with the scam flag when the API set one. */
function Typed({ text, flagged }: { text: string | null; flagged?: boolean }) {
  if (text === null) return <span className="font-normal text-gray-500">None</span>;
  return (
    <span className="block whitespace-pre-wrap font-normal">
      {text}
      {flagged && (
        <span className="mt-1 flex items-center gap-1 text-[12.5px] font-semibold text-amber-600">
          <AlertTriangle size={12} aria-hidden /> Looks like a scam pattern
        </span>
      )}
    </span>
  );
}

/** The event's structured values in words (they never hold text a user typed: §5.3). */
export function rentalEventDetail(values: Record<string, string | number | boolean | null>): string | null {
  const parts: string[] = [];
  if (typeof values.versionSeq === 'number') parts.push(`Version ${values.versionSeq}`);
  if (typeof values.totalPaise === 'number') parts.push(formatPaise(values.totalPaise));
  if (typeof values.category === 'string' && (RENTAL_DISPUTE_CATEGORIES as readonly string[]).includes(values.category)) {
    parts.push(DISPUTE_CATEGORY_LABELS[values.category as (typeof RENTAL_DISPUTE_CATEGORIES)[number]]);
  }
  if (typeof values.outcome === 'string' && values.outcome in DISPUTE_OUTCOME_SHORT) {
    parts.push(`Outcome: ${DISPUTE_OUTCOME_SHORT[values.outcome as DisputeOutcome].toLowerCase()}`);
  }
  if (typeof values.reason === 'string') {
    if (values.reason in RENTAL_FINAL_REASON_LABELS) parts.push(RENTAL_FINAL_REASON_LABELS[values.reason as RentalFinalReason]);
    else if (values.reason in RENTAL_CANCEL_REASON_LABELS) parts.push(RENTAL_CANCEL_REASON_LABELS[values.reason as RentalCancelReason]);
    else if (values.reason in RENTAL_DECLINE_REASON_LABELS) parts.push(RENTAL_DECLINE_REASON_LABELS[values.reason as RentalDeclineReason]);
  }
  if (values.finalChanged === true) parts.push('Final amount differs from the agreed total');
  if (typeof values.photos === 'number' && values.photos > 0) parts.push(`${values.photos} photo${values.photos === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : null;
}

function Thumbs({ urls, label, onOpen }: { urls: string[]; label: string; onOpen: (i: number) => void }) {
  if (urls.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {urls.map((url, i) => (
        <button
          key={url}
          type="button"
          onClick={() => onOpen(i)}
          className="h-20 w-20 overflow-hidden rounded-lg border border-gray-200 bg-photo"
          aria-label={`Open ${label} photo ${i + 1} of ${urls.length}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}

function VersionsTable({ versions }: { versions: RentalVersionView[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-[12.5px] text-gray-600">
          <tr>
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">By</th>
            <th className="px-3 py-2 font-semibold">Dates</th>
            <th className="px-3 py-2 font-semibold">Period</th>
            <th className="px-3 py-2 font-semibold">Machines</th>
            <th className="px-3 py-2 font-semibold">Operator · transport</th>
            <th className="px-3 py-2 font-semibold">Estimate</th>
            <th className="px-3 py-2 font-semibold">Total</th>
            <th className="px-3 py-2 font-semibold">Message</th>
            <th className="px-3 py-2 font-semibold">Sent</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {versions.map((v) => (
            <tr key={v.seq} className="align-top">
              <td className="px-3 py-2 tnum">{v.seq}</td>
              <td className="px-3 py-2">{RENTAL_ACTOR_LABELS[v.proposedBy]}</td>
              <td className="px-3 py-2 tnum">{formatDayRange(v.startDate, v.endDate)}</td>
              <td className="px-3 py-2 tnum">{periodWords(v.period, v.count)}</td>
              <td className="px-3 py-2 tnum">{v.machines}</td>
              <td className="px-3 py-2">{v.withOperator ? 'With operator' : 'No operator'} · {v.ownerDelivers ? 'Owner delivers' : 'Renter picks up'}</td>
              <td className="px-3 py-2 tnum">{formatPaise(v.estimatePaise)}</td>
              <td className="px-3 py-2 font-semibold tnum">{formatPaise(v.totalPaise)}</td>
              <td className="max-w-[16rem] px-3 py-2"><Typed text={v.message} flagged={v.messageFlagged} /></td>
              <td className="px-3 py-2 text-gray-600 tnum">{formatDateTime(v.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One rental booking for admins (M14 spec §15, R15): the current terms, money and the listing's terms as snapshotted,
 * the site (address as stored: staff only, never cached), on site and return with hour meters and photos (signed URLs,
 * lightbox), notes (masked, scam flag), every version, the timeline, the dispute and the reviews' state. Read-only:
 * Cancel booking sits in the page header.
 */
export function RentalDetail({ booking: b }: { booking: AdminRentalBookingDetail }) {
  const { hasRole } = useAuth();
  // The nav roles of the pages linked from here.
  const canOpenBusinesses = hasRole('support', 'verification_officer', 'moderator');
  const canOpenListings = hasRole('moderator', 'support');
  const canOpenDisputes = hasRole('support');
  const [lightbox, setLightbox] = useState<{ set: 'onSite' | 'returned'; index: number } | null>(null);
  const c = b.current;
  const t = b.terms;
  const n = b.notes;

  const hoursRun = b.onSite?.hourMeter != null && b.returned?.hourMeter != null ? b.returned.hourMeter - b.onSite.hourMeter : null;
  const rates = (Object.keys(RATE_KEY) as RentalPeriod[]).flatMap((p) => {
    const paise = t[RATE_KEY[p]];
    return paise == null ? [] : [<span key={p} className="block tnum">{formatPaise(paise)} a {RENTAL_PERIOD_LABELS[p]}</span>];
  });

  const lifecycle: Array<[string, ReactNode]> = [];
  if (b.turn && (b.status === 'requested' || b.status === 'countered')) {
    lifecycle.push(['Waiting for', RENTAL_TURN_LABELS[b.turn]]);
    lifecycle.push(['Reply due', when(b.replyDueAt)]);
  }
  lifecycle.push(['Changes', <span key="ch" className="tnum">{b.changeCount} made, {b.changesLeft} left</span>]);
  if (b.onSite) {
    lifecycle.push(['On site', <span key="os">{when(b.onSite.at)}<span className="font-normal text-gray-600"> · marked by the {RENTAL_ACTOR_LABELS[b.onSite.bySide].toLowerCase()}</span></span>]);
    lifecycle.push(['Hour meter at start', b.onSite.hourMeter != null ? <span className="font-mono">{b.onSite.hourMeter.toLocaleString('en-IN')}</span> : '—']);
  }
  if (b.returned) {
    lifecycle.push(['Returned', when(b.returned.at)]);
    lifecycle.push(['Hour meter at return', b.returned.hourMeter != null ? <span className="font-mono">{b.returned.hourMeter.toLocaleString('en-IN')}</span> : '—']);
    if (hoursRun !== null) lifecycle.push(['Hours run', <span key="hr" className="font-mono">{hoursRun.toLocaleString('en-IN')}</span>]);
    lifecycle.push(['Damage note', <Typed key="dn" text={b.returned.damageNote} />]);
  }
  if (b.autoCompleteAt && b.status === 'returned') lifecycle.push(['Auto-completes', when(b.autoCompleteAt)]);
  if (b.completedAt) {
    lifecycle.push(['Completed', <span key="c">{when(b.completedAt)}{b.completedHow && <span className="font-normal text-gray-600"> · {RENTAL_COMPLETED_HOW_LABELS[b.completedHow]}</span>}</span>]);
  }
  if (b.cancelled) {
    lifecycle.push([
      'Cancelled',
      <span key="x">
        {when(b.cancelled.at)}
        <span className="font-normal text-gray-600">
          {` · by ${RENTAL_ACTOR_LABELS[b.cancelled.bySide].toLowerCase()}`}
          {b.cancelled.reason && ` · ${RENTAL_CANCEL_REASON_LABELS[b.cancelled.reason]}`}
        </span>
      </span>,
    ]);
    if (b.cancelled.note !== null) lifecycle.push(['Cancel note', <Typed key="cn" text={b.cancelled.note} />]);
  }
  if (b.declineReason) lifecycle.push(['Declined because', RENTAL_DECLINE_REASON_LABELS[b.declineReason]]);

  const reviews = b.reviews;
  const reviewWords = reviews.published
    ? 'Published'
    : reviews.renterSubmitted || reviews.ownerSubmitted
      ? `Waiting: ${[reviews.renterSubmitted && 'renter', reviews.ownerSubmitted && 'owner'].filter(Boolean).join(' and ')} submitted`
      : b.status === 'completed' ? 'None yet' : 'Opens when the booking completes';

  const photoSets = { onSite: b.photos.onSite, returned: b.photos.returned };

  return (
    <div className="space-y-4">
      {b.clashWith && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-600">
          <AlertTriangle size={14} aria-hidden />
          Clashes with booking
          <Link href={`/rentals/${b.clashWith.id}/`} className="font-mono text-brand-700 hover:underline">{formatBookingRef(b.clashWith.ref)}</Link>
          still out on this machine.
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Booking">
          <Facts
            rows={[
              ['Status', <StatusBadge key="s" status={b.status} label={RENTAL_BOOKING_STATUS_LABELS[b.status]} tone={rentalBookingStatusTone(b.status)} />],
              ['Machine', canOpenListings
                ? <Link key="l" href={`/listings/${b.listing.id}/`} className="text-brand-700 hover:underline">{b.listing.title}</Link>
                : b.listing.title],
              ['Renter', <PartyName key="r" party={b.renter} canOpen={canOpenBusinesses} />],
              ['Owner', <PartyName key="o" party={b.owner} canOpen={canOpenBusinesses} />],
              ['Dates', <span key="d" className="tnum">{formatDayRange(c.startDate, c.endDate)}</span>],
              ['Period', <span key="p" className="tnum">{periodWords(c.period, c.count)}</span>],
              ['Machines', <span key="m" className="tnum">{c.machines}</span>],
              ['Operator', c.withOperator ? 'With operator' : 'No operator'],
              ['Transport', c.ownerDelivers ? 'Owner delivers' : 'Renter picks up'],
              ['Estimate', <span key="e" className="tnum">{formatPaise(c.estimatePaise)}</span>],
              ['Agreed total', b.agreedTotalPaise !== null ? <span className="tnum">{formatPaise(b.agreedTotalPaise)}</span> : 'Not agreed yet'],
              ...(b.finalAmountPaise !== null
                ? [['Final amount', (
                  <span key="f">
                    <span className="tnum">{formatPaise(b.finalAmountPaise)}</span>
                    {b.finalAmountReason && <span className="font-normal text-gray-600"> · {RENTAL_FINAL_REASON_LABELS[b.finalAmountReason]}</span>}
                    {b.finalAmountNote !== null && <Typed text={b.finalAmountNote} />}
                  </span>
                )] as [string, ReactNode]]
                : []),
            ]}
          />
        </Panel>

        <Panel title="Listing terms at request">
          <Facts
            rows={[
              ['Rates', rates.length ? <span>{rates}</span> : '—'],
              ['Day and month', `A day is ${t.shiftHours} hours; a month is ${t.monthDays} working days`],
              ['Minimum', t.minDuration != null ? `${t.minDuration} ${t.minDurationPeriod ? RENTAL_PERIOD_LABELS[t.minDurationPeriod] : ''}`.trim() : '—'],
              ['Operator', t.operator ? `${OPERATOR_LABELS[t.operator]}${t.operatorRateDayPaise != null ? `, ${formatPaise(t.operatorRateDayPaise)} a day` : ''}` : '—'],
              ['Fuel', FUEL_LABELS[t.fuel]],
              ['Transport', t.transport ? `${TRANSPORT_LABELS[t.transport]}${t.transportChargePaise != null ? `, ${formatPaise(t.transportChargePaise)} each way` : ''}` : '—'],
              ['Deposit', t.depositPaise != null ? <span className="tnum">{formatPaise(t.depositPaise)}</span> : '—'],
              ['Works within', t.serviceRadiusKm != null ? `${t.serviceRadiusKm} km` : '—'],
            ]}
          />
        </Panel>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Site">
          <Facts
            rows={[
              ['Place', `${b.site.city}, ${b.site.state}`],
              ['Pincode', <span key="pc" className="font-mono">{b.site.pincode}</span>],
              ['Address', b.site.address ?? '—'],
              ['From the machine', b.site.distanceKm !== null
                ? <span key="km" className="tnum">{b.site.distanceKm} km{b.site.beyondServiceRadius && <span className="font-semibold text-amber-600"> · beyond the service radius</span>}</span>
                : '—'],
            ]}
          />
          <p className="mt-3 text-[12.5px] text-gray-500">
            Staff see the address as the renter wrote it. The owner sees it from confirmation, masked until both share their numbers.
          </p>
        </Panel>

        <Panel title="Notes">
          <Facts
            rows={[
              ['Payment', n.paymentMethod ? PAYMENT_METHOD_LABELS[n.paymentMethod] : '—'],
              ['Advance', n.advancePaise !== null ? <span className="tnum">{formatPaise(n.advancePaise)}</span> : '—'],
              ['Deposit', n.depositPaise !== null ? <span className="tnum">{formatPaise(n.depositPaise)}</span> : '—'],
              ['Deposit returned', yesNo(n.depositReturned)],
              ['Expected on site', n.expectedOnSiteTime ? <span className="tnum">{n.expectedOnSiteTime}</span> : '—'],
              ['Written note', <Typed key="t" text={n.text} flagged={n.textFlagged} />],
              ['Last changed', when(n.updatedAt)],
            ]}
          />
        </Panel>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Lifecycle">
          <Facts rows={lifecycle} />
          {photoSets.onSite.length > 0 && (
            <div className="mt-3">
              <h3 className="text-xs font-bold text-gray-600">On-site photos</h3>
              <Thumbs urls={photoSets.onSite} label="on-site" onOpen={(index) => setLightbox({ set: 'onSite', index })} />
            </div>
          )}
          {photoSets.returned.length > 0 && (
            <div className="mt-3">
              <h3 className="text-xs font-bold text-gray-600">Return photos</h3>
              <Thumbs urls={photoSets.returned} label="return" onOpen={(index) => setLightbox({ set: 'returned', index })} />
            </div>
          )}
        </Panel>

        <Panel title="Dispute and reviews">
          <Facts
            rows={[
              ['Dispute', b.dispute ? (
                <span key="d" className="inline-flex flex-wrap items-center gap-2">
                  {canOpenDisputes
                    ? <Link href={`/disputes/${b.dispute.id}/`} className="text-brand-700 hover:underline">Open the dispute</Link>
                    : <span>Reported</span>}
                  <StatusBadge status={b.dispute.status} label={DISPUTE_STATUS_LABELS[b.dispute.status]} tone={DISPUTE_STATUS_TONES[b.dispute.status]} />
                  {b.dispute.outcome && <span className="font-normal text-gray-600">Outcome: {DISPUTE_OUTCOME_SHORT[b.dispute.outcome].toLowerCase()}</span>}
                </span>
              ) : 'No problem reported'],
              ['Reviews', reviewWords],
            ]}
          />
        </Panel>
      </div>

      <Panel title={`Versions (${b.versions.length})`}>
        <VersionsTable versions={b.versions} />
      </Panel>

      <Panel title="Timeline">
        {b.events.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing recorded yet.</p>
        ) : (
          <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {b.events.map((e, i) => {
              const detail = rentalEventDetail(e.values);
              return (
                <li key={`${e.code}-${e.at}-${i}`} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold text-gray-900">{RENTAL_EVENT_LABELS[e.code] ?? e.code}</span>
                    <span className="text-gray-500">{e.actorAdminName ? `Support (${e.actorAdminName})` : RENTAL_ACTOR_LABELS[e.actorSide]}</span>
                    <span className="ml-auto text-xs text-gray-500 tnum">{formatDateTime(e.at)}</span>
                  </div>
                  {detail && <p className="mt-0.5 text-[13px] text-gray-600">{detail}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <ImageLightbox
        urls={lightbox ? photoSets[lightbox.set] : []}
        index={lightbox?.index ?? null}
        onIndex={(index) => setLightbox((l) => (l ? { ...l, index } : l))}
        onClose={() => setLightbox(null)}
        label={lightbox?.set === 'returned' ? 'Return photo' : 'On-site photo'}
      />
    </div>
  );
}
