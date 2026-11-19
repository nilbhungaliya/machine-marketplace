import {
  DEAL_CANCEL_REASONS_BUYER, DEAL_CANCEL_REASONS_SELLER,
  type DealAction, type DealStatus, type DealTimelineEntry, type DealView, type PartySide,
} from '@mpm/shared-types';
import { toAsciiDigits } from './digits';
import { formatDayMonth, formatTime, formatWeekdayShort } from './format-date';

// The Deal record's decisions (F6 + F7 spec §9, §15.1; textile app `lib/deal-display.ts` without payments, dispatch or
// samples). Buttons come only from the server's `view.actions` (the API's `dealActions`): this file places them. Money
// stays decimal strings (P4). Pure.

export type DealFooterAction = Extract<DealAction, 'hand_over' | 'confirm_received' | 'cancel' | 'report_problem'>;

export interface DealButtons {
  /** The footer's main button (violet): hand over (seller, agreed) or confirm received (buyer, handed over). */
  primary: DealFooterAction | null;
  /** The footer's other button (outline): cancel (agreed) or report a problem (handed over). */
  secondary: DealFooterAction | null;
  /** The cancel-request banner's buttons (§9.5): the other side accepts or declines, the requester withdraws. */
  cancelRequest: { accept: boolean; clear: boolean };
  /** "Ask to cancel" under the footer (handed over, no request yet). */
  requestCancel: boolean;
  editNotes: boolean;
  shareContact: boolean;
  review: boolean;
}

/**
 * Where each server action goes on the Deal record (§9.2, §9.5): a primary and a secondary footer button, the cancel
 * request banner, the "Ask to cancel" link, the notes Edit, the contact tick and the review card. Nothing the server
 * didn't offer is ever shown (a viewer gets nothing).
 */
export function dealActionButtons(view: Pick<DealView, 'actions'>): DealButtons {
  const has = (a: DealAction) => view.actions.includes(a);
  const primary: DealFooterAction | null = has('hand_over') ? 'hand_over' : has('confirm_received') ? 'confirm_received' : null;
  const secondaryOrder: DealFooterAction[] = ['cancel', 'report_problem'];
  const secondary = secondaryOrder.find((a) => has(a)) ?? null;
  return {
    primary,
    secondary,
    cancelRequest: { accept: has('accept_cancel_request'), clear: has('clear_cancel_request') },
    requestCancel: has('request_cancel'),
    editNotes: has('edit_notes'),
    shareContact: has('share_contact'),
    review: has('review'),
  };
}

/** The reasons a side picks from when it cancels or asks to cancel (§9.5). */
export function cancelReasonsFor(side: PartySide): readonly string[] {
  return side === 'buyer' ? DEAL_CANCEL_REASONS_BUYER : DEAL_CANCEL_REASONS_SELLER;
}

/** `total − advance` in paise as decimal strings (P4, BigInt); null without an advance or with an unreadable value. */
export function balanceOf(totalPaise: string, advancePaise: string | null | undefined): string | null {
  if (advancePaise == null || !/^\d+$/.test(advancePaise) || !/^\d+$/.test(totalPaise)) return null;
  return (BigInt(totalPaise) - BigInt(advancePaise)).toString();
}

/** A deal deadline in IST: "Thu 21 Nov, 4:40 pm" (§9.3: plain calendar time, shown as date and time in IST). */
export function formatDeadline(ms: number): string {
  return `${formatWeekdayShort(ms)} ${formatDayMonth(ms)}, ${formatTime(ms)}`;
}

/**
 * The handed-over callout's two times (§9.3, mockup deals · "Handed over"): when the deal completes on its own and,
 * while still open, the end of the buyer's report window. Null outside `handed_over`.
 */
export function deadlineCopy(
  deal: Pick<DealView, 'status' | 'autoCompleteAt' | 'problemDeadlineAt'>,
  now: number,
): { completesOn: string | null; reportUntil: string | null } | null {
  if (deal.status !== 'handed_over') return null;
  const complete = deal.autoCompleteAt ? Date.parse(deal.autoCompleteAt) : NaN;
  const report = deal.problemDeadlineAt ? Date.parse(deal.problemDeadlineAt) : NaN;
  return {
    completesOn: Number.isNaN(complete) ? null : formatDeadline(complete),
    reportUntil: Number.isNaN(report) || report <= now ? null : formatDeadline(report),
  };
}

export interface TimelineRow {
  key: string;
  /** `deals.timeline.<code>` (with `values`) for a past event, `deals.timeline.next.<step>` for what comes next. */
  labelKey: string;
  values: Record<string, string | number>;
  /** IST time of a past event; a deadline for the next step, else empty. */
  when: string;
  done: boolean;
}

const EVENT_VALUE_KEYS = ['reason', 'outcome', 'category', 'how', 'side'] as const;

/**
 * The Deal record's timeline (§9.1, mockups "Deal record", "Handed over"): every `deal_events` row in order, then the
 * next step still open: "Handed over · Waiting" while agreed, "Completed · Auto on Thu 21 Nov" while handed over,
 * "Reviews" once completed. Values the copy needs are strings or numbers (reason codes become keys in the copy).
 */
export function timelineRows(
  events: readonly DealTimelineEntry[],
  deal: Pick<DealView, 'status' | 'autoCompleteAt'>,
): TimelineRow[] {
  const rows: TimelineRow[] = events.map((e, i) => {
    const values: Record<string, string | number> = { actor: e.actorSide };
    for (const k of EVENT_VALUE_KEYS) {
      const v = e.values[k];
      if (typeof v === 'string' || typeof v === 'number') values[k] = v;
    }
    const at = Date.parse(e.at);
    return {
      key: `${e.code}-${i}`,
      labelKey: `deals.timeline.${e.code}`,
      values,
      when: Number.isNaN(at) ? '' : `${formatDayMonth(at)}, ${formatTime(at)}`,
      done: true,
    };
  });
  const next = nextStep(deal);
  if (next) rows.push(next);
  return rows;
}

function nextStep(deal: Pick<DealView, 'status' | 'autoCompleteAt'>): TimelineRow | null {
  const status: DealStatus = deal.status;
  if (status === 'agreed') {
    return { key: 'next-handover', labelKey: 'deals.timeline.next.handOver', values: {}, when: '', done: false };
  }
  if (status === 'handed_over') {
    const at = deal.autoCompleteAt ? Date.parse(deal.autoCompleteAt) : NaN;
    return {
      key: 'next-complete', labelKey: 'deals.timeline.next.complete', values: {},
      when: Number.isNaN(at) ? '' : formatDeadline(at), done: false,
    };
  }
  if (status === 'completed') {
    return { key: 'next-reviews', labelKey: 'deals.timeline.next.reviews', values: {}, when: '', done: false };
  }
  return null;
}

/** A deal status as a chip: label key and tone (Agreed violet-new, Handed over amber, Completed green…). */
export function dealStatusChip(status: DealStatus): { key: string; tone: 'new' | 'warn' | 'ok' | 'neutral' | 'danger' } {
  switch (status) {
    case 'agreed': return { key: 'deals.status.agreed', tone: 'new' };
    case 'handed_over': return { key: 'deals.status.handed_over', tone: 'warn' };
    case 'completed': return { key: 'deals.status.completed', tone: 'ok' };
    case 'disputed': return { key: 'deals.status.disputed', tone: 'danger' };
    case 'cancelled':
    default: return { key: 'deals.status.cancelled', tone: 'neutral' };
  }
}

/** The review card on a completed deal (§9.4, P14): "Rate this deal" while the reader may, else the state of reviews. */
export function reviewCardState(view: Pick<DealView, 'status' | 'actions' | 'review'>):
  { kind: 'rate' } | { kind: 'waiting' } | { kind: 'published' } | { kind: 'closed' } | null {
  if (view.status !== 'completed' || !view.review) return null;
  if (view.actions.includes('review') && view.review.eligible) return { kind: 'rate' };
  const mine = view.review.mine;
  if (mine?.publishedAt) return { kind: 'published' };
  if (mine) return { kind: 'waiting' };
  return { kind: 'closed' };
}

/**
 * A typed day for the notes' expected date ("21-11-2026", "21/11/2026", Hindi / Gujarati digits) → `YYYY-MM-DD`; ''
 * clears it; null when it isn't a real date.
 */
export function parseDayInput(text: string): string | '' | null {
  const clean = toAsciiDigits(text).trim();
  if (clean === '') return '';
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(clean);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` → the field's text ("21-11-2026"). */
export function dayInputText(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/** The advance is at most the deal's total (§9.1); both in paise as decimal strings. */
export function advanceFits(advancePaise: string, totalPaise: string): boolean {
  return /^\d+$/.test(advancePaise) && /^\d+$/.test(totalPaise) && BigInt(advancePaise) <= BigInt(totalPaise);
}

/** Paise as a decimal string → the rupee text an input is prefilled with ("2000050" → "20000.50"), without floats. */
export function rupeesInputText(paise: string | null | undefined): string {
  if (paise == null || !/^\d+$/.test(paise)) return '';
  const p = BigInt(paise);
  const rest = p % 100n;
  return rest ? `${p / 100n}.${rest.toString().padStart(2, '0')}` : (p / 100n).toString();
}
