'use client';

import Link from 'next/link';
import type { AdminDealDetail, AdminDisputeRow } from '@mpm/shared-types';
import StatusBadge from '@/components/status-badge';
import { Panel } from '@/components/ui/panel';
import {
  CANCEL_REASON_LABELS, CANCELLED_BY_LABELS, COMPLETED_HOW_LABELS, DEAL_STATUS_LABELS, DEAL_STATUS_TONES, FULFILMENT_LABELS,
  HOLD_STATUS_LABELS, PARTY_SIDE_LABELS, PAYMENT_METHOD_LABELS, formatPaiseString,
} from '@/lib/deals-api';
import { DISPUTE_CATEGORY_LABELS, DISPUTE_OUTCOME_SHORT, DISPUTE_STATUS_LABELS, DISPUTE_STATUS_TONES } from '@/lib/disputes-api';
import { GST_MODE_LABELS, formatPaise, formatRef } from '@/lib/listings-api';
import { formatDate, formatDateTime } from '@/lib/utils';
import { DealTimeline } from './deal-timeline';
import { Facts } from './facts';

const when = (iso: string | null) => (iso ? <span className="tnum">{formatDateTime(iso)}</span> : '—');

/** The disputes of a deal, linked to the Disputes queue for the roles that see it. */
export function DisputeList({ disputes, canOpen }: { disputes: AdminDisputeRow[]; canOpen: boolean }) {
  if (disputes.length === 0) return <p className="text-sm text-gray-500">No problem reported on this deal.</p>;
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
      {disputes.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
          {canOpen ? (
            <Link href={`/disputes/${d.id}/`} className="font-semibold text-brand-700 hover:underline">{DISPUTE_CATEGORY_LABELS[d.category]}</Link>
          ) : (
            <span className="font-semibold text-gray-900">{DISPUTE_CATEGORY_LABELS[d.category]}</span>
          )}
          <span className="text-gray-500">by the {PARTY_SIDE_LABELS[d.openedBySide].toLowerCase()}</span>
          <StatusBadge status={d.status} label={DISPUTE_STATUS_LABELS[d.status]} tone={DISPUTE_STATUS_TONES[d.status]} />
          {d.outcome && <span className="text-gray-700">Outcome: {DISPUTE_OUTCOME_SHORT[d.outcome].toLowerCase()}</span>}
          <span className="ml-auto text-xs text-gray-500 tnum">
            {formatDate(d.createdAt)}{d.resolvedAt ? ` → ${formatDate(d.resolvedAt)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One deal for admins (F6 + F7 spec §16.1): terms, the structured notes (the free text is never sent: only whether
 * there is one), lifecycle, timeline, hold, review state and its disputes. Read-only.
 */
export function DealDetail({ deal, canOpenDisputes }: { deal: AdminDealDetail; canOpenDisputes: boolean }) {
  const n = deal.notes;
  const lifecycle: Array<[string, React.ReactNode]> = [
    ['Agreed', when(deal.acceptedAt)],
    ['Handed over', when(deal.handedOverAt)],
  ];
  if (deal.problemDeadlineAt) lifecycle.push(['Problem window ends', when(deal.problemDeadlineAt)]);
  if (deal.autoCompleteAt && deal.status === 'handed_over') lifecycle.push(['Auto-completes', when(deal.autoCompleteAt)]);
  if (deal.completedAt) {
    lifecycle.push(['Completed', <span key="c"><span className="tnum">{formatDateTime(deal.completedAt)}</span>{deal.completedHow && <span className="font-normal text-gray-600"> · {COMPLETED_HOW_LABELS[deal.completedHow]}</span>}</span>]);
  }
  if (deal.cancelledAt) {
    lifecycle.push([
      'Cancelled',
      <span key="x">
        <span className="tnum">{formatDateTime(deal.cancelledAt)}</span>
        <span className="font-normal text-gray-600">
          {deal.cancelledBySide && ` · by ${CANCELLED_BY_LABELS[deal.cancelledBySide]}`}
          {deal.cancelReason && ` · ${CANCEL_REASON_LABELS[deal.cancelReason]}`}
        </span>
      </span>,
    ]);
  }
  if (deal.cancelRequest) {
    lifecycle.push([
      'Cancel requested',
      <span key="r">
        by the {PARTY_SIDE_LABELS[deal.cancelRequest.side].toLowerCase()}
        {deal.cancelRequest.reason && ` · ${CANCEL_REASON_LABELS[deal.cancelRequest.reason]}`}
        <span className="font-normal text-gray-600 tnum"> · {formatDateTime(deal.cancelRequest.at)}</span>
      </span>,
    ]);
  }

  const reviews = deal.reviews;
  const reviewWords = reviews.published
    ? 'Published'
    : reviews.buyerSubmitted || reviews.sellerSubmitted
      ? `Waiting: ${[reviews.buyerSubmitted && 'buyer', reviews.sellerSubmitted && 'seller'].filter(Boolean).join(' and ')} submitted`
      : deal.status === 'completed' ? 'None yet' : 'Opens when the deal completes';

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Terms">
          <Facts
            rows={[
              ['Status', <StatusBadge key="s" status={deal.status} label={DEAL_STATUS_LABELS[deal.status]} tone={DEAL_STATUS_TONES[deal.status]} />],
              ['Listing', <span key="l">{deal.listing.title} <span className="font-mono text-[13px] text-gray-500">{formatRef(deal.listing.ref)}</span></span>],
              ['Buyer', <Link key="b" href={`/businesses/${deal.buyer.businessId}/`} className="text-brand-700 hover:underline">{deal.buyer.name}</Link>],
              ['Seller', <Link key="s2" href={`/businesses/${deal.seller.businessId}/`} className="text-brand-700 hover:underline">{deal.seller.name}</Link>],
              ['Price per unit', <span key="p" className="tnum">{formatPaise(deal.pricePerUnitPaise)}{deal.gstMode && <span className="font-normal text-gray-600"> · {GST_MODE_LABELS[deal.gstMode]}</span>}</span>],
              ['Quantity', <span key="q" className="tnum">{deal.quantity} {deal.unitLabel}</span>],
              ['Total', <span key="t" className="tnum">{formatPaiseString(deal.totalPaise)}</span>],
            ]}
          />
        </Panel>
        <Panel title="Deal notes">
          <Facts
            rows={[
              ['Payment', n.paymentMethod ? PAYMENT_METHOD_LABELS[n.paymentMethod] : '—'],
              ['Advance', n.advancePaise ? <span className="tnum">{formatPaiseString(n.advancePaise)}</span> : '—'],
              ['Pickup or delivery', n.fulfilment ? FULFILMENT_LABELS[n.fulfilment] : '—'],
              ['Expected on', n.expectedOn ? <span className="tnum">{formatDate(n.expectedOn)}</span> : '—'],
              ['Written note', n.hasText ? 'The parties added a note (not shown to admins)' : 'None'],
            ]}
          />
        </Panel>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Lifecycle">
          <Facts rows={lifecycle} />
        </Panel>
        <Panel title="Stock and reviews">
          <Facts
            rows={[
              ['Stock hold', deal.hold ? <span key="h">{HOLD_STATUS_LABELS[deal.hold.status]} <span className="font-normal text-gray-600 tnum">· {deal.hold.quantity} {deal.unitLabel}</span></span> : 'None'],
              ['Reviews', reviewWords],
            ]}
          />
        </Panel>
      </div>

      <Panel title="Timeline">
        <DealTimeline entries={deal.timeline} />
      </Panel>

      <Panel title="Disputes">
        <DisputeList disputes={deal.disputes} canOpen={canOpenDisputes} />
      </Panel>
    </div>
  );
}
