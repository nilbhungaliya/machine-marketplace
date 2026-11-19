import type {
  DealCancelReason, DisputeCategory, DisputeOutcome, InboxFilter, InboxPage, InboxPill, InboxRow, OfferCloseReason, PartySide,
  SystemLineCode, ThreadMessage,
} from '@mpm/shared-types';
import { CHAT_LIMITS } from '@mpm/shared-types';
import { formatRupees } from './money';

/**
 * Pure helpers for the Chats tab and the thread (F6 + F7 spec §6.9, §6.10, §13; ported from textile
 * `lib/chat-format.ts`). The API masks text per reader before it reaches the app (`visibleText`), so nothing here looks
 * at what a message says or re-builds masked text: it only places messages and rows, and turns codes into copy keys.
 */

/** `i18next`'s `t`, narrowed to what these helpers call (tests pass a fake). */
export type Translate = (key: string, params?: Record<string, unknown>) => string;

// ─── Inbox rows ───

/** The last line of an inbox row (§6.10): masked text, "2 photos", the system line's code, "Offer ₹34,000 /pc". */
export function previewFor(row: Pick<InboxRow, 'lastMessage'>, t: Translate): string {
  const m = row.lastMessage;
  if (!m) return t('chats.preview.none');
  let line: string;
  switch (m.kind) {
    case 'text':
      line = m.text ?? '';
      break;
    case 'photos':
      line = m.text ? t('chats.preview.photosCaption', { count: m.photoCount, text: m.text }) : t('chats.preview.photos', { count: m.photoCount });
      break;
    case 'enquiry':
      line = t('chats.preview.enquiry');
      break;
    case 'offer':
      if (!m.offer) {
        line = t('chats.preview.offerNoPrice');
      } else {
        const price = formatRupees(m.offer.pricePerUnitPaise);
        line = m.offer.unitLabel ? t('chats.preview.offerPerUnit', { price, unit: m.offer.unitLabel }) : t('chats.preview.offer', { price });
      }
      break;
    case 'deal':
      return t('chats.preview.deal');
    case 'system':
      return m.systemCode ? t(`chats.systemPreview.${m.systemCode}`) : '';
    default:
      return '';
  }
  return m.isMine ? t('chats.preview.mine', { text: line }) : line;
}

/** The row's pill (§6.10): Your turn beats Deal beats the enquiry status. */
export function pillFor(row: Pick<InboxRow, 'yourTurn' | 'pill' | 'enquiryStatus'>): InboxPill {
  if (row.yourTurn) return 'your_turn';
  if (row.pill === 'deal') return 'deal';
  return row.enquiryStatus;
}

export type PillTone = 'sun' | 'ok' | 'info' | 'neutral' | 'new';

/** The kit `StatusChip` tone of each pill: the yellow badge only for Your turn (mockup `.pill`), green for a deal. */
export function pillTone(pill: InboxPill): PillTone {
  switch (pill) {
    case 'your_turn':
      return 'sun';
    case 'deal':
    case 'converted':
      return 'ok';
    case 'replied':
      return 'info';
    case 'open':
      return 'new';
    default:
      return 'neutral';
  }
}

/** A count for a badge: nothing at 0, the number up to 99, then "99+". */
export function unreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}

/** Whether a row is in an inbox list (`GET /threads?filter=&archived=`). */
export function rowBelongs(row: Pick<InboxRow, 'archived' | 'side' | 'yourTurn'>, filter: InboxFilter, archived: boolean): boolean {
  if (row.archived !== archived) return false;
  switch (filter) {
    case 'buying':
      return row.side === 'buyer';
    case 'selling':
      return row.side === 'seller';
    case 'your_turn':
      return row.yourTurn;
    default:
      return true;
  }
}

/** Whether a row counts in `counts.yourTurn` (the server counts unarchived threads waiting on the reader). */
const countsTurn = (row: Pick<InboxRow, 'archived' | 'yourTurn'>): number => (row.yourTurn && !row.archived ? 1 : 0);

/**
 * How `counts.yourTurn` moves when `next` replaces `prev`; null when the previous row isn't known (a thread no cached
 * list holds yet), so the caller asks the server again.
 */
export function yourTurnDelta(prev: InboxRow | undefined, next: InboxRow): number | null {
  if (!prev) return null;
  return countsTurn(next) - countsTurn(prev);
}

/** The row with this thread id in any cached page, if any. */
export function findRow(pages: readonly InboxPage[] | undefined, threadId: string): InboxRow | undefined {
  for (const page of pages ?? []) {
    const row = page.items.find((r) => r.threadId === threadId);
    if (row) return row;
  }
  return undefined;
}

/**
 * A row from the socket (`message:new`'s per-reader `row`) applied to one cached list: it leaves wherever it was and,
 * when it belongs to the list, goes to the top (it has the newest line). `openThreadId`: the thread on screen, whose
 * unread stays 0 (the screen marks it read). `turnDelta` moves `counts.yourTurn` on every page.
 */
export function applyInboxRow(
  pages: InboxPage[],
  row: InboxRow,
  list: { filter: InboxFilter; archived: boolean },
  turnDelta: number,
  openThreadId: string | null,
): InboxPage[] {
  const placed: InboxRow = openThreadId === row.threadId ? { ...row, unread: 0 } : row;
  const belongs = rowBelongs(placed, list.filter, list.archived);
  return pages.map((page, index) => {
    const items = page.items.filter((r) => r.threadId !== row.threadId);
    return {
      ...page,
      items: index === 0 && belongs ? [placed, ...items] : items,
      counts: { yourTurn: Math.max(0, page.counts.yourTurn + turnDelta) },
    };
  });
}

/** The reader read the thread (here or on another device, `thread:read`): its unread goes to 0 at once. */
export function markRowRead(pages: InboxPage[], threadId: string): InboxPage[] {
  return pages.map((page) => ({
    ...page,
    items: page.items.map((r) => (r.threadId === threadId && r.unread !== 0 ? { ...r, unread: 0 } : r)),
  }));
}

/** The thread leaves a list (archived or unarchived from the menu); the lists are asked again after. */
export function removeRow(pages: InboxPage[], threadId: string): InboxPage[] {
  return pages.map((page) => ({ ...page, items: page.items.filter((r) => r.threadId !== threadId) }));
}

// ─── Messages ───

/** A page of `GET /threads/:id/messages`: newest first. */
export type MessagePage = ThreadMessage[];

const seqOf = (m: Pick<ThreadMessage, 'seq'>): bigint => BigInt(m.seq);

/**
 * A message (from the socket or a send's reply) placed in the thread's pages, newest first, exactly once: the socket
 * and the reply can both bring it, and a retried send brings it again. A known id is replaced in place (fresh photo
 * URLs); a new one goes where its `seq` says; one older than every loaded message is left for the older page's fetch.
 */
export function addMessageToPages(pages: readonly MessagePage[], msg: ThreadMessage): MessagePage[] {
  if (pages.some((page) => page.some((m) => m.id === msg.id))) {
    return pages.map((page) => page.map((m) => (m.id === msg.id ? msg : m)));
  }
  if (pages.length === 0) return [[msg]];
  const seq = seqOf(msg);
  // The same seq under another id can't happen; never show it twice if it did.
  if (pages.some((page) => page.some((m) => seqOf(m) === seq))) return pages.map((page) => [...page]);
  const out = pages.map((page) => [...page]);
  for (const page of out) {
    const at = page.findIndex((m) => seqOf(m) < seq);
    if (at !== -1) {
      page.splice(at, 0, msg);
      return out;
    }
  }
  // Older than everything loaded: the first page is still empty (a brand-new thread) or the older page will bring it.
  if (out[0]!.length === 0) out[0]!.push(msg);
  return out;
}

/** An offer card's latest state (`offer:updated`) in every message that shows it. */
export function applyOfferUpdate(pages: readonly MessagePage[], offer: NonNullable<ThreadMessage['offer']>): MessagePage[] {
  return pages.map((page) => page.map((m) => (m.offer && m.offer.id === offer.id ? { ...m, offer } : m)));
}

/** The newest message's `seq`, to mark the thread read up to it. */
export function newestSeq(pages: readonly MessagePage[] | undefined): string | null {
  return pages?.[0]?.[0]?.seq ?? null;
}

/** `?before=<seq>` of the next (older) page, or undefined after a short page. */
export function olderPageParam(last: MessagePage): string | undefined {
  if (last.length < CHAT_LIMITS.messagesPageSize) return undefined;
  return last[last.length - 1]?.seq;
}

/** Whether two messages fall on different days in India (a day line between them). */
export function differentIstDay(a: string, b: string): boolean {
  const day = (iso: string) => Math.floor((Date.parse(iso) + 330 * 60_000) / 86_400_000);
  return day(a) !== day(b);
}

/** A photo URL expires in 300 s (§6.8): refetch the page a little before, so a tap never opens a dead link. */
export function photosExpired(messages: readonly Pick<ThreadMessage, 'photos'>[], nowMs: number, marginMs = 15_000): boolean {
  return messages.some((m) => m.photos.some((p) => Date.parse(p.expiresAt) - marginMs <= nowMs));
}

// ─── System lines (§6.9) ───

/** Who a system line's `by` / `side` value is, for the reader. */
function whose(value: unknown, mySide: PartySide): 'mine' | 'theirs' | 'both' | 'system' {
  if (value === mySide) return 'mine';
  if (value === 'buyer' || value === 'seller') return 'theirs';
  if (value === 'both') return 'both';
  return 'system';
}

const OFFER_CLOSE: readonly OfferCloseReason[] = ['listing_unavailable', 'listing_changed', 'blocked', 'account_inactive'];
const CANCEL_REASONS: readonly DealCancelReason[] = [
  'no_longer_needed', 'found_elsewhere', 'seller_not_responding', 'buyer_not_responding', 'payment_not_received',
  'stock_problem', 'listing_removed', 'support_closed', 'other',
];
const PROBLEM_CATEGORIES: readonly DisputeCategory[] = [
  'not_as_described', 'damaged', 'short_quantity', 'not_received', 'payment_not_received', 'other',
];
const OUTCOMES: readonly DisputeOutcome[] = ['completed', 'cancelled', 'resumed'];
/** `deal_notes_changed`'s `fields` names (API `NOTE_FIELDS`). */
export const NOTE_FIELD_NAMES = ['payment_method', 'advance', 'fulfilment', 'expected_on', 'text'] as const;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** A copy key plus its params; params that are themselves keys are translated by `renderSystemLine`. */
export interface SystemLineCopy {
  key: string;
  params: Record<string, string | number>;
  /** Params whose value is a copy key to translate first (reason, category, fields). */
  keyParams: Record<string, string | string[]>;
  /** `deal_dispute_resolved`'s message from support, shown as written under the line. */
  supportMessage: string | null;
}

/**
 * A system line's key and params (§6.9) for this reader: `by` / `side` become "You" or the other business (separate
 * keys, so Hindi and Gujarati keep their grammar), reason, category and changed fields become their own keys, the deal
 * ref is a number. Values are codes and ids only, never free text (except support's resolution message).
 */
export function systemLineParams(
  code: SystemLineCode,
  values: Record<string, string | number> | null | undefined,
  ctx: { mySide: PartySide; counterpartName: string },
): SystemLineCopy {
  const v = values ?? {};
  const base = `chats.system.${code}`;
  const ref = typeof v.ref === 'number' || typeof v.ref === 'string' ? String(v.ref) : '';
  const params: Record<string, string | number> = { name: ctx.counterpartName, ref };
  const keyParams: Record<string, string | string[]> = {};
  let key = base;
  let supportMessage: string | null = null;
  switch (code) {
    case 'offer_withdrawn':
    case 'offer_rejected':
      key = `${base}.${whose(v.side, ctx.mySide) === 'mine' ? 'mine' : 'theirs'}`;
      break;
    case 'blocked':
      key = `${base}.${whose(v.side, ctx.mySide) === 'mine' ? 'mine' : 'theirs'}`;
      break;
    case 'offers_closed':
      key = `${base}.${oneOf(v.reason, OFFER_CLOSE, 'listing_unavailable')}`;
      break;
    case 'deal_notes_changed': {
      key = `${base}.${whose(v.by, ctx.mySide) === 'mine' ? 'mine' : 'theirs'}`;
      const fields = String(v.fields ?? '')
        .split(',')
        .filter((f): f is (typeof NOTE_FIELD_NAMES)[number] => (NOTE_FIELD_NAMES as readonly string[]).includes(f));
      keyParams.fields = (fields.length ? fields : ['text']).map((f) => `chats.noteField.${f}`);
      break;
    }
    case 'deal_cancel_requested':
    case 'deal_cancel_request_withdrawn':
      key = `${base}.${whose(v.by, ctx.mySide) === 'mine' ? 'mine' : 'theirs'}`;
      break;
    case 'deal_cancelled': {
      const who = whose(v.by, ctx.mySide);
      key = `${base}.${who}`;
      keyParams.reason = `chats.cancelReason.${oneOf(v.reason, CANCEL_REASONS, 'other')}`;
      break;
    }
    case 'deal_problem_reported':
      key = `${base}.${whose(v.by, ctx.mySide) === 'mine' ? 'mine' : 'theirs'}`;
      keyParams.category = `chats.problemCategory.${oneOf(v.category, PROBLEM_CATEGORIES, 'other')}`;
      break;
    case 'deal_dispute_resolved':
      key = `${base}.${oneOf(v.outcome, OUTCOMES, 'resumed')}`;
      supportMessage = typeof v.message === 'string' && v.message.trim() ? v.message : null;
      break;
    default:
      break;
  }
  return { key, params, keyParams, supportMessage };
}

/** The finished line in the reader's language. */
export function renderSystemLine(copy: SystemLineCopy, t: Translate): string {
  const params: Record<string, unknown> = { ...copy.params };
  for (const [name, value] of Object.entries(copy.keyParams)) {
    params[name] = Array.isArray(value) ? value.map((k) => t(k)).join(', ') : t(value);
  }
  return t(copy.key, params);
}
