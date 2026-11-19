import type { DealCancelReason, DealTimelineEntry, DisputeOutcome } from '@mpm/shared-types';
import { ACTOR_SIDE_LABELS, CANCEL_REASON_LABELS, DEAL_EVENT_LABELS } from '@/lib/deals-api';
import { DISPUTE_OUTCOME_SHORT } from '@/lib/disputes-api';
import { formatDateTime } from '@/lib/utils';

const NOTE_FIELD_LABELS: Record<string, string> = {
  paymentMethod: 'payment method',
  advancePaise: 'advance',
  fulfilment: 'pickup or delivery',
  expectedOn: 'expected date',
  notesText: 'note',
  text: 'note',
};

/** The event's structured values in words (they never hold text: §5.9). */
export function timelineDetail(entry: DealTimelineEntry): string | null {
  const v = entry.values as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof v.reason === 'string' && v.reason in CANCEL_REASON_LABELS) parts.push(CANCEL_REASON_LABELS[v.reason as DealCancelReason]);
  if (typeof v.outcome === 'string' && v.outcome in DISPUTE_OUTCOME_SHORT) parts.push(`Outcome: ${DISPUTE_OUTCOME_SHORT[v.outcome as DisputeOutcome].toLowerCase()}`);
  if (typeof v.stockReturned === 'boolean') parts.push(v.stockReturned ? 'Goods went back to the seller' : 'Goods stayed with the buyer');
  if (v.photo === true) parts.push('With a photo');
  if (Array.isArray(v.fields) && v.fields.length > 0) {
    parts.push(`Changed: ${v.fields.map((f) => NOTE_FIELD_LABELS[String(f)] ?? String(f)).join(', ')}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** A deal's events, oldest first (§5.9): what happened, which side, when. */
export function DealTimeline({ entries }: { entries: DealTimelineEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-gray-500">Nothing recorded yet.</p>;
  return (
    <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200">
      {entries.map((e, i) => {
        const detail = timelineDetail(e);
        return (
          <li key={`${e.code}-${e.at}-${i}`} className="px-3 py-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-gray-900">{DEAL_EVENT_LABELS[e.code] ?? e.code}</span>
              <span className="text-gray-500">{ACTOR_SIDE_LABELS[e.actorSide]}</span>
              <span className="ml-auto text-xs text-gray-500 tnum">{formatDateTime(e.at)}</span>
            </div>
            {detail && <p className="mt-0.5 text-[13px] text-gray-600">{detail}</p>}
          </li>
        );
      })}
    </ol>
  );
}
