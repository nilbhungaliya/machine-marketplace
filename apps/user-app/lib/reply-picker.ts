import {
  PART_REQUEST_LIMITS,
  REPLY_FIT_REASONS,
  type PartRequestSellerView,
  type ReplyFitReason,
  type ReplyOption,
  type SellerReplyView,
} from '@mpm/shared-types';

// The seller's side of a part request (F8 spec §9.2, §12.3, §13.1): the "Reply with my listing" picker, the status line
// of each of the seller's replies, and which actions the seller page offers. Pure; copy keys under `buyers.*`.

/** One row of the reply picker. */
export interface PickerRow {
  listingId: string;
  option: ReplyOption;
  /** In the current selection. */
  selected: boolean;
  /** Can't be tapped: the listing doesn't fit, or the selection is full. */
  disabled: boolean;
  /** Why the listing can't answer (`buyers.reply.reason.<reason>`); null for a fitting listing. */
  reasonKey: string | null;
}

/** How many listings one send may carry: the request's slots left, today's replies left, and 3 a call. */
export function selectionCap(slotsLeft: number, dailyLeft: number = Number.POSITIVE_INFINITY): number {
  return Math.max(0, Math.min(slotsLeft, dailyLeft, PART_REQUEST_LIMITS.replyListingsPerCall));
}

/** The copy key for a reason a listing can't answer (`kind`, `category`, `side`, `condition`, `replied`). */
export function replyReasonKey(reason: ReplyFitReason | null): string {
  return reason ? `buyers.reply.reason.${reason}` : 'buyers.reply.reason.other';
}

/**
 * The picker's rows (§9.2): fitting listings first (in the server's order), the others after them greyed with their
 * reason. A fitting row is disabled once the selection holds `min(slotsLeft, 3)` listings and it isn't one of them.
 * Ids in `selected` that aren't fitting options are ignored.
 */
export function pickerRows(options: readonly ReplyOption[], slotsLeft: number, selected: readonly string[]): PickerRow[] {
  const cap = selectionCap(slotsLeft);
  const fitting = options.filter((o) => o.fit);
  const fittingIds = new Set(fitting.map((o) => o.listingId));
  const chosen = selected.filter((id) => fittingIds.has(id));
  const full = chosen.length >= cap;
  const rows: PickerRow[] = fitting.map((option) => {
    const isSelected = chosen.includes(option.listingId);
    return { listingId: option.listingId, option, selected: isSelected, disabled: !isSelected && full, reasonKey: null };
  });
  for (const option of options) {
    if (option.fit) continue;
    rows.push({ listingId: option.listingId, option, selected: false, disabled: true, reasonKey: replyReasonKey(option.reason) });
  }
  return rows;
}

/**
 * Tap on a row: removes a selected listing, adds a fitting one while there is room (`cap`, from `selectionCap`), and
 * otherwise returns the selection unchanged (a greyed listing, a 4th listing, one beyond the slots left).
 */
export function toggleSelection(
  selected: readonly string[], listingId: string, options: readonly ReplyOption[], cap: number,
): string[] {
  if (selected.includes(listingId)) return selected.filter((id) => id !== listingId);
  const option = options.find((o) => o.listingId === listingId);
  if (!option?.fit) return [...selected];
  if (selected.length >= Math.min(cap, PART_REQUEST_LIMITS.replyListingsPerCall)) return [...selected];
  return [...selected, listingId];
}

/** The selection without listings that are no longer fitting options (after a refetch). */
export function keepFitting(selected: readonly string[], options: readonly ReplyOption[]): string[] {
  const fitting = new Set(options.filter((o) => o.fit).map((o) => o.listingId));
  return selected.filter((id) => fitting.has(id));
}

/**
 * The copy key for `400 REPLY_LISTING_INVALID` (`details.reasons`: listing id → reason, or `{ draft: 'kind' }`): the
 * first reason the picker knows (`buyers.reply.invalid.<reason>`), else a generic line (`not_found`, `not_live`).
 */
export function replyInvalidKey(details: Record<string, unknown>): string {
  const reasons = details.reasons;
  if (reasons && typeof reasons === 'object') {
    const known = Object.values(reasons as Record<string, unknown>).find(
      (r): r is ReplyFitReason => typeof r === 'string' && (REPLY_FIT_REASONS as readonly string[]).includes(r),
    );
    if (known) return `buyers.reply.invalid.${known}`;
  }
  return 'buyers.reply.invalid.generic';
}

/** The listing ids a `REPLY_LISTING_INVALID` / `REPLY_EXISTS` error names, to drop from the selection. */
export function rejectedListingIds(details: Record<string, unknown>): string[] {
  const ids = details.listingIds;
  if (Array.isArray(ids)) return ids.filter((x): x is string => typeof x === 'string');
  const reasons = details.reasons;
  if (reasons && typeof reasons === 'object') return Object.keys(reasons).filter((k) => k !== 'draft');
  return [];
}

export type ReplyStatusTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

/** A reply's status line on the seller's page (§13.1): pending, sent, seen, withdrawn, or why it was dropped. */
export function replyStatusLine(reply: Pick<SellerReplyView, 'status' | 'dropReason' | 'seenByBuyer'>): { key: string; tone: ReplyStatusTone } {
  switch (reply.status) {
    case 'pending': return { key: 'buyers.myReplies.pending', tone: 'info' };
    case 'delivered': return reply.seenByBuyer
      ? { key: 'buyers.myReplies.seen', tone: 'ok' }
      : { key: 'buyers.myReplies.delivered', tone: 'ok' };
    case 'withdrawn': return { key: 'buyers.myReplies.withdrawn', tone: 'neutral' };
    case 'dropped': return { key: `buyers.myReplies.dropped.${reply.dropReason ?? 'other'}`, tone: 'warn' };
  }
}

/** A pending or delivered reply can be withdrawn (§9.3). */
export function canWithdraw(reply: Pick<SellerReplyView, 'status'>): boolean {
  return reply.status === 'pending' || reply.status === 'delivered';
}

export interface SellerActions {
  /** A `viewer` member: reads only (R2). */
  viewer: boolean;
  reply: boolean;
  notRelevant: boolean;
  undoNotRelevant: boolean;
  report: boolean;
  withdraw: boolean;
  /** Why Reply isn't offered (`buyers.request.replyBlocked.*`), or null. */
  replyBlockedKey: string | null;
}

/**
 * What the seller page offers (§12.3, R2). The API's `canReply` is "active, not a viewer, slots left", so an active
 * request with slots left and `canReply` false is read by a viewer: no Reply, Not relevant, Withdraw or Report (all
 * `403 VIEWER_READ_ONLY`). A viewer with no slots left can't be told apart; the API still refuses its writes.
 */
export function sellerActions(
  view: Pick<PartRequestSellerView, 'status' | 'canReply' | 'slotsLeft' | 'notRelevant'>,
): SellerActions {
  const active = view.status === 'active';
  const viewer = active && view.slotsLeft > 0 && !view.canReply;
  const replyBlockedKey = view.canReply
    ? null
    : !active ? 'buyers.request.replyBlocked.closed'
      : viewer ? 'buyers.request.replyBlocked.viewer'
        : 'buyers.request.replyBlocked.full';
  return {
    viewer,
    reply: view.canReply,
    notRelevant: active && !viewer && !view.notRelevant,
    undoNotRelevant: active && !viewer && view.notRelevant,
    report: !viewer,
    withdraw: !viewer,
    replyBlockedKey,
  };
}
