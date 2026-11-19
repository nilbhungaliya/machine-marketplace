'use client';

import { useState } from 'react';
import { AlertTriangle, EyeOff } from 'lucide-react';
import type { AdminThreadMessage, AdminThreadRead } from '@mpm/shared-types';
import ImageLightbox from '@/components/image-lightbox';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { QUICK_ENQUIRY_LABELS, SYSTEM_LINE_LABELS } from '@/lib/conversations-api';
import { PARTY_SIDE_LABELS } from '@/lib/deals-api';
import { formatRef } from '@/lib/listings-api';
import { cn, formatDateTime } from '@/lib/utils';

function Photos({ message, onOpen }: { message: AdminThreadMessage; onOpen: (urls: string[], index: number) => void }) {
  if (message.photos.length === 0) return null;
  const urls = message.photos.map((p) => p.url);
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {urls.map((url, i) => (
        <button
          key={url}
          type="button"
          onClick={() => onOpen(urls, i)}
          className="h-16 w-16 overflow-hidden rounded-lg border border-gray-200 bg-photo"
          aria-label={`Open photo ${i + 1} of ${urls.length}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}

function MessageBody({ m }: { m: AdminThreadMessage }) {
  if (m.kind === 'system' && m.system) {
    return <span className="text-gray-600">{SYSTEM_LINE_LABELS[m.system.code] ?? m.system.code}</span>;
  }
  if (m.kind === 'enquiry' && m.enquiry) {
    const e = m.enquiry;
    return (
      <span className="block space-y-1">
        <span className="block font-semibold text-gray-900">Enquiry</span>
        {e.quick.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {e.quick.map((q) => (
              <span key={q} className="rounded-full bg-gray-100 px-2 py-px text-[12px] font-semibold text-gray-700">{QUICK_ENQUIRY_LABELS[q]}</span>
            ))}
          </span>
        )}
        {e.quantity && <span className="block text-gray-700">Quantity: <span className="tnum">{e.quantity}</span></span>}
        {e.machine && (
          <span className="block text-gray-700">
            Machine: {e.machine.brandName}{e.machine.modelName ? ` ${e.machine.modelName}` : ''}{e.machine.year ? ` (${e.machine.year})` : ''}
            {' · '}{e.machine.verdict === 'fits' ? 'Listed as fitting' : 'Not listed as fitting'}
          </span>
        )}
        {e.note && <span className="block whitespace-pre-wrap text-gray-900">{e.note}</span>}
      </span>
    );
  }
  if (m.kind === 'offer') return <span className="text-gray-600">Offer card{m.text ? ':' : ''} {m.text && <span className="whitespace-pre-wrap text-gray-900">{m.text}</span>}</span>;
  if (m.kind === 'deal') return <span className="text-gray-600">Deal card</span>;
  return m.text ? <span className="whitespace-pre-wrap text-gray-900">{m.text}</span> : null;
}

/**
 * A conversation read by staff (F6 + F7 spec §16.3): messages as stored (unmasked: the reader is staff) with their
 * photos (signed for 300 s), system lines in words, never the revealed contact numbers (the API leaves them out). The
 * data lives only in the caller's state; Close drops it.
 */
export function ConversationView({ read, basis, onClose }: {
  read: AdminThreadRead;
  /** The basis the read was allowed on, repeated so the reader keeps it in mind. */
  basis: string;
  onClose: () => void;
}) {
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

  return (
    <Panel
      title={`Conversation · ${read.listing.title}`}
      action={(
        <Button variant="secondary" size="sm" onClick={onClose}>
          <EyeOff size={14} aria-hidden /> Close conversation
        </Button>
      )}
    >
      <p className="mb-3 text-[13px] text-gray-600">
        <span className="font-mono">{formatRef(read.listing.ref)}</span> · {read.buyer.name} (buyer) and {read.seller.name} (seller).
        {' '}Opened on the basis of {basis}; this read is in the audit log. Reload the page to read again.
      </p>
      {read.messages.length === 0 ? (
        <p className="text-sm text-gray-500">No messages.</p>
      ) : (
        <ol className="max-h-[36rem] space-y-2 overflow-y-auto rounded-xl bg-gray-50 p-3">
          {read.messages.map((m) => {
            const system = m.kind === 'system';
            return (
              <li
                key={m.id}
                className={cn(
                  'text-sm',
                  system ? 'text-center text-[12.5px]' : 'max-w-[80%] rounded-xl border border-gray-200 bg-white px-3 py-2',
                  !system && m.senderSide === 'seller' && 'ml-auto',
                )}
              >
                {!system && (
                  <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2 text-[12px]">
                    <span className="font-bold text-gray-900">{m.senderName ?? (m.senderSide ? PARTY_SIDE_LABELS[m.senderSide] : 'Unknown')}</span>
                    {m.senderSide && <span className="text-gray-500">{PARTY_SIDE_LABELS[m.senderSide]}</span>}
                    {m.scamFlag && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-px text-[11px] font-bold text-red-600">
                        <AlertTriangle size={11} aria-hidden /> Scam warning shown
                      </span>
                    )}
                    <span className="ml-auto text-gray-500 tnum">{formatDateTime(m.createdAt)}</span>
                  </div>
                )}
                <MessageBody m={m} />
                <Photos message={m} onOpen={(urls, index) => setLightbox({ urls, index })} />
                {system && <span className="ml-2 text-gray-400 tnum">{formatDateTime(m.createdAt)}</span>}
              </li>
            );
          })}
        </ol>
      )}
      <ImageLightbox
        urls={lightbox?.urls ?? []}
        index={lightbox?.index ?? null}
        onIndex={(index) => setLightbox((l) => (l ? { ...l, index } : l))}
        onClose={() => setLightbox(null)}
        label="Conversation photo"
      />
    </Panel>
  );
}
