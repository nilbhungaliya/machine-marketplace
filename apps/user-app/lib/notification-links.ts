import { NOTIFICATION_TYPES, type Badges, type NotificationRow, type NotificationType } from '@mpm/shared-types';

// Where a notification opens (F6 + F7 spec §11.3; plan L8-2) and what a push carries (§11.5). Pure. A notification id
// never grants access: each screen checks it as it always does.

export type NotificationRoute =
  | { name: 'Thread'; params: { threadId: string } }
  | { name: 'DealRecord'; params: { dealId: string } }
  | { name: 'ReviewDeal'; params: { dealId: string } }
  | { name: 'MyReviews'; params: undefined }
  | { name: 'MyListings'; params: undefined }
  | { name: 'Requirement'; params: { partRequestId: string; tab?: 'replies' | 'matches' } };

export type NotificationTarget = Pick<NotificationRow, 'type' | 'threadId' | 'dealId' | 'reviewId' | 'offerId' | 'partRequestId'>;

/** F8 §10: every `part_*` type opens the request (its page picks the buyer or the seller view). */
const REQUEST_TYPES: readonly NotificationType[] = [
  'part_match', 'part_request_new', 'part_request_reply', 'part_request_expiring', 'part_request_expired',
  'part_request_fulfil_prompt', 'part_request_removed', 'part_request_reply_dropped',
];

function requirement(type: NotificationType, id: string | null): NotificationRoute | null {
  if (!id) return null;
  if (type === 'part_request_reply') return { name: 'Requirement', params: { partRequestId: id, tab: 'replies' } };
  if (type === 'part_match') return { name: 'Requirement', params: { partRequestId: id, tab: 'matches' } };
  return { name: 'Requirement', params: { partRequestId: id } };
}

const THREAD_TYPES: readonly NotificationType[] = [
  'enquiry_new', 'message_new', 'offer_new', 'offer_quote', 'offer_countered', 'offer_rejected', 'offer_expiring',
  'offer_backup', 'offer_revived',
];
const DEAL_TYPES: readonly NotificationType[] = [
  'offer_accepted', 'deal_handed_over', 'deal_cancel_requested', 'deal_cancelled', 'deal_completed', 'deal_problem',
  'deal_dispute_resolved', 'deal_agreed_reminder',
];

const thread = (id: string | null): NotificationRoute | null => (id ? { name: 'Thread', params: { threadId: id } } : null);
const deal = (id: string | null): NotificationRoute | null => (id ? { name: 'DealRecord', params: { dealId: id } } : null);

/**
 * The screen a notification opens (§11.3): chat and offer events → the thread; an accepted offer and every deal event →
 * the Deal record; `review_received` → Profile › Reviews (with Reply); `review_waiting` → the review form of that deal.
 * A row without the id it needs falls back to the other id it has (deal, then thread); null when nothing fits.
 */
export function notificationLink(n: NotificationTarget): NotificationRoute | null {
  if (THREAD_TYPES.includes(n.type)) return thread(n.threadId) ?? deal(n.dealId);
  if (DEAL_TYPES.includes(n.type)) return deal(n.dealId) ?? thread(n.threadId);
  if (n.type === 'review_received') return { name: 'MyReviews', params: undefined };
  if (n.type === 'review_waiting') return n.dealId ? { name: 'ReviewDeal', params: { dealId: n.dealId } } : null;
  if (n.type === 'listing_status') return { name: 'MyListings', params: undefined };
  if (REQUEST_TYPES.includes(n.type)) return requirement(n.type, n.partRequestId) ?? deal(n.dealId) ?? thread(n.threadId);
  // `booking_update`: a later module (M14).
  return deal(n.dealId) ?? thread(n.threadId);
}

/** A push's id-only data (§11.5): FCM data values are strings; never text. */
export interface PushData extends NotificationTarget {
  notificationId: string;
  deliveryKey: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Reads a push's `data`; null when it isn't one of ours (no notification id, delivery key or known type). */
export function parsePushData(data: unknown): PushData | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const notificationId = str(d.notificationId);
  const deliveryKey = str(d.deliveryKey);
  const type = str(d.type);
  if (!notificationId || !deliveryKey || !type || !(NOTIFICATION_TYPES as readonly string[]).includes(type)) return null;
  return {
    notificationId,
    deliveryKey,
    type: type as NotificationType,
    threadId: str(d.threadId),
    offerId: str(d.offerId),
    dealId: str(d.dealId),
    reviewId: str(d.reviewId),
    partRequestId: str(d.partRequestId),
  };
}

/** A foreground chat push for the thread already on screen is not shown (the server skips most of these too). */
export function isPushForOpenThread(push: PushData, route: { name: string; params?: unknown } | undefined): boolean {
  if (!route || route.name !== 'Thread' || !push.threadId) return false;
  const params = route.params as { threadId?: unknown } | undefined;
  return params?.threadId === push.threadId;
}

// ─── Badges (§15.2) ───

/** The count a tab shows: Chats = unread threads, Deals = deals waiting on you; other tabs none. */
export function tabBadgeCount(tab: string, badges: Badges | null | undefined): number {
  if (!badges) return 0;
  if (tab === 'Chats') return badges.unreadThreads;
  if (tab === 'Deals') return badges.dealsYourTurn;
  return 0;
}

/** A badge's text: nothing at 0 (or a bad count), "99+" above 99. */
export function badgeText(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}
