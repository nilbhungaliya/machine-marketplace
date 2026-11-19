'use client';

import Link from 'next/link';
import type { AdminEnquiryDetail, AdminOfferChainEntry } from '@mpm/shared-types';
import { Facts } from '@/components/deals/facts';
import StatusBadge from '@/components/status-badge';
import { Panel } from '@/components/ui/panel';
import { DEAL_STATUS_LABELS, DEAL_STATUS_TONES, PARTY_SIDE_LABELS, formatDealRef, formatPaiseString } from '@/lib/deals-api';
import {
  ENQUIRY_STATUS_LABELS, OFFER_CLOSE_REASON_LABELS, OFFER_KIND_LABELS, OFFER_STATUS_LABELS, OFFER_STATUS_TONES,
} from '@/lib/enquiries-api';
import { KIND_LABELS, formatPaise, formatRef } from '@/lib/listings-api';
import { formatDateTime } from '@/lib/utils';

/** The chain's rows grouped by negotiation, in the order they started. */
function negotiations(chain: AdminOfferChainEntry[]): AdminOfferChainEntry[][] {
  const groups = new Map<string, AdminOfferChainEntry[]>();
  for (const entry of chain) {
    const list = groups.get(entry.negotiationId) ?? [];
    list.push(entry);
    groups.set(entry.negotiationId, list);
  }
  return Array.from(groups.values());
}

/**
 * One conversation's offers (F6 + F7 spec §16.1): who offered what price and quantity, when, and how each row ended,
 * grouped by negotiation, plus the deals it produced. **No message or note text** (read-only monitor).
 */
export function OfferChain({ detail, canOpenDeals }: { detail: AdminEnquiryDetail; canOpenDeals: boolean }) {
  const { row, chain, deals } = detail;
  const groups = negotiations(chain);

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Conversation">
          <Facts
            rows={[
              ['Listing', <span key="l">{row.listing.title} <span className="font-mono text-[13px] text-gray-500">{formatRef(row.listing.ref)}</span></span>],
              ['Kind', KIND_LABELS[row.listing.kind]],
              ['Buyer', <Link key="b" href={`/businesses/${row.buyer.businessId}/`} className="text-brand-700 hover:underline">{row.buyer.name}</Link>],
              ['Seller', <Link key="s" href={`/businesses/${row.seller.businessId}/`} className="text-brand-700 hover:underline">{row.seller.name}</Link>],
              ['Enquiry', <StatusBadge key="e" status={row.enquiryStatus} label={ENQUIRY_STATUS_LABELS[row.enquiryStatus]} />],
              ['Started', <span key="c" className="tnum">{formatDateTime(row.createdAt)}</span>],
              ['Last activity', <span key="a" className="tnum">{formatDateTime(row.lastActivityAt)}</span>],
            ]}
          />
        </Panel>
        <Panel title="Deals">
          {deals.length === 0 ? (
            <p className="text-sm text-gray-500">No deal in this conversation yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  {canOpenDeals ? (
                    <Link href={`/deals/${d.id}/`} className="font-mono font-semibold text-brand-700 hover:underline">{formatDealRef(d.ref)}</Link>
                  ) : (
                    <span className="font-mono font-semibold text-gray-900">{formatDealRef(d.ref)}</span>
                  )}
                  <StatusBadge status={d.status} label={DEAL_STATUS_LABELS[d.status]} tone={DEAL_STATUS_TONES[d.status]} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Offers">
        {groups.length === 0 ? (
          <p className="text-sm text-gray-500">No offer in this conversation yet.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((group, i) => (
              <div key={group[0].negotiationId}>
                <h3 className="mb-2 text-[13px] font-bold text-gray-600">
                  Negotiation {i + 1} · {OFFER_KIND_LABELS[group[0].kind]}
                </h3>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table aria-label={`Negotiation ${i + 1}`} className="min-w-full divide-y divide-gray-100 text-sm">
                    <thead className="bg-gray-50/80">
                      <tr>
                        {['Round', 'From', 'Price per unit', 'Quantity', 'Total', 'Status', 'Sent', 'Expires', 'Answered'].map((h) => (
                          <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {group.map((o) => (
                        <tr key={o.id}>
                          <td className="px-3 py-2 tnum">{o.round}</td>
                          <td className="px-3 py-2">{PARTY_SIDE_LABELS[o.senderSide]}</td>
                          <td className="px-3 py-2 tnum">{formatPaise(o.pricePerUnitPaise)}</td>
                          <td className="px-3 py-2 tnum">{o.quantity}</td>
                          <td className="px-3 py-2 tnum">{formatPaiseString(o.totalPaise)}</td>
                          <td className="px-3 py-2">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <StatusBadge status={o.status} label={OFFER_STATUS_LABELS[o.status]} tone={OFFER_STATUS_TONES[o.status]} />
                              {o.closeReason && <span className="text-[12.5px] text-gray-500">{OFFER_CLOSE_REASON_LABELS[o.closeReason]}</span>}
                              {o.needsReconfirm && <span className="rounded-full bg-amber-50 px-2 py-px text-[11px] font-bold text-amber-600">Needs reconfirm</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2 tnum">{formatDateTime(o.createdAt)}</td>
                          <td className="px-3 py-2 tnum">{o.expiresAt ? formatDateTime(o.expiresAt) : '—'}</td>
                          <td className="px-3 py-2 tnum">{o.answeredAt ? formatDateTime(o.answeredAt) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[12.5px] text-gray-500">
          Offer notes and messages are not shown here. Support can read a conversation only through a report or a dispute.
        </p>
      </Panel>
    </div>
  );
}
