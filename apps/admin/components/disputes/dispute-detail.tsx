'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MessagesSquare } from 'lucide-react';
import type { AdminDisputeDetail, AdminThreadRead } from '@mpm/shared-types';
import { ConversationView } from '@/components/conversations/conversation-view';
import { ReadReasonDialog } from '@/components/conversations/read-reason-dialog';
import { DealDetail } from '@/components/deals/deal-detail';
import { Facts } from '@/components/deals/facts';
import ImageLightbox from '@/components/image-lightbox';
import StatusBadge from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { PARTY_SIDE_LABELS, formatDealRef } from '@/lib/deals-api';
import {
  DISPUTE_CATEGORY_LABELS, DISPUTE_OUTCOME_LABELS, DISPUTE_STATUS_LABELS, DISPUTE_STATUS_TONES,
} from '@/lib/disputes-api';
import { formatDateTime } from '@/lib/utils';
import { ResolveDialog } from './resolve-dialog';

/**
 * One dispute for support (F6 + F7 spec §9.6, §16.1): the problem as reported (description, photos signed for 300 s),
 * the resolution once decided, Read conversation (reason dialog, audit-logged, result kept in this component only),
 * Resolve while open, then the deal itself (terms, structured notes, timeline, hold).
 */
export function DisputeDetail({ dispute, onChanged }: { dispute: AdminDisputeDetail; onChanged: () => Promise<void> | void }) {
  const [resolving, setResolving] = useState(false);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<AdminThreadRead | null>(null);
  const [photo, setPhoto] = useState<number | null>(null);
  const open = dispute.status === 'open';
  const basis = `the dispute on deal ${formatDealRef(dispute.dealRef)}`;
  const urls = dispute.photos.map((p) => p.url);

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel
          title="Problem reported"
          action={open && (
            <Button size="sm" onClick={() => setResolving(true)}>Resolve</Button>
          )}
        >
          <Facts
            rows={[
              ['Status', <StatusBadge key="s" status={dispute.status} label={DISPUTE_STATUS_LABELS[dispute.status]} tone={DISPUTE_STATUS_TONES[dispute.status]} />],
              ['Problem', DISPUTE_CATEGORY_LABELS[dispute.category]],
              ['Reported by', `${PARTY_SIDE_LABELS[dispute.openedBySide]}, ${dispute.openedBySide === 'buyer' ? dispute.buyer.name : dispute.seller.name}`],
              ['Reported', <span key="c" className="tnum">{formatDateTime(dispute.createdAt)}</span>],
            ]}
          />
          <p className="mt-3 whitespace-pre-wrap rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-900">{dispute.description}</p>
          {urls.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {urls.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setPhoto(i)}
                  className="h-20 w-20 overflow-hidden rounded-lg border border-gray-200 bg-photo"
                  aria-label={`Open photo ${i + 1} of ${urls.length}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Conversation"
          action={!read && (
            <Button size="sm" variant="secondary" onClick={() => setReading(true)}>
              <MessagesSquare size={14} aria-hidden /> Read conversation
            </Button>
          )}
        >
          <p className="text-sm text-gray-600">
            Messages are private. You may read this conversation because of {basis}, with a reason; every read is
            recorded in the audit log. Contact numbers the parties shared are never shown.
          </p>
          <p className="mt-2 text-sm">
            <Link href={`/deals/${dispute.dealId}/`} className="font-semibold text-brand-700 hover:underline">
              Open deal {formatDealRef(dispute.dealRef)} in Deals
            </Link>
          </p>
        </Panel>
      </div>

      {dispute.status === 'resolved' && dispute.outcome && (
        <Panel title="Resolution">
          <Facts
            rows={[
              ['Outcome', DISPUTE_OUTCOME_LABELS[dispute.outcome].label],
              ...(dispute.outcome === 'cancelled' && dispute.stockReturned !== null
                ? [['Goods back to the seller', dispute.stockReturned ? 'Yes: the stock was released' : 'No: the stock was taken'] as [string, string]]
                : []),
              ['Resolved', <span key="r" className="tnum">{dispute.resolvedAt ? formatDateTime(dispute.resolvedAt) : '—'}{dispute.resolvedByAdminName ? ` by ${dispute.resolvedByAdminName}` : ''}</span>],
              ['Internal note', <span key="n" className="whitespace-pre-wrap font-normal">{dispute.internalNote ?? '—'}</span>],
              ['Message to parties', <span key="m" className="whitespace-pre-wrap font-normal">{dispute.messageToParties ?? 'None'}</span>],
            ]}
          />
        </Panel>
      )}

      {read && <ConversationView read={read} basis={basis} onClose={() => setRead(null)} />}

      <DealDetail deal={dispute.deal} canOpenDisputes />

      {resolving && (
        <ResolveDialog
          dispute={dispute}
          onClose={() => setResolving(false)}
          onResolved={onChanged}
        />
      )}
      {reading && (
        <ReadReasonDialog
          threadId={dispute.threadId}
          basis={{ kind: 'dispute', label: `Dispute on deal ${formatDealRef(dispute.dealRef)}` }}
          onClose={() => setReading(false)}
          onRead={setRead}
        />
      )}
      <ImageLightbox urls={urls} index={photo} onIndex={setPhoto} onClose={() => setPhoto(null)} label="Problem photo" />
    </div>
  );
}
