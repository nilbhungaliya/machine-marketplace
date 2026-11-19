import type {
  CategoryNode, ListingKind, ListingOwnerView, ListingProblem, ListingStatus, MyListingCard, MyListingsGroup, PartSide,
  SellerListingAction,
} from '@mpm/shared-types';
import {
  CATEGORY_EDITABLE_STATUSES, EDITABLE_LISTING_STATUSES, PUBLIC_LISTING_STATUSES, sellerActions,
} from '@mpm/shared-types';
import { errorCode } from './api-error';
import type { StatusTone } from '@/components/StatusChip';
import { incompleteProblems } from './listing-errors';
import { expiresText, updatedAgo } from './listing-format';
import { firstIncompleteStep, stepForProblem, wizardSteps, type EditStep } from './sell-wizard';
import type { SellStep } from './sell-steps';

// My listings (F2 spec §10): which segment a status sits in, and how its StatusChip reads. Pure.

/** The four segments of the SegmentedControl, in order; `drafts` and `removed_by_team` are rows above it. */
export const MY_LISTINGS_SEGMENTS = ['live', 'review', 'paused', 'sold'] as const satisfies readonly MyListingsGroup[];

const GROUP: Record<ListingStatus, MyListingsGroup> = {
  live: 'live',
  reserved: 'live',
  rented: 'live',
  pending_review: 'review',
  rejected: 'review',
  paused: 'paused',
  expired: 'paused',
  unavailable: 'paused',
  hidden: 'paused',
  sold: 'sold',
  draft: 'drafts',
  removed: 'removed_by_team',
};

/** Live (live, reserved, rented) · In review (pending review, rejected) · Paused (paused, expired, unavailable, hidden) · Sold. */
export function statusGroup(status: ListingStatus): MyListingsGroup {
  return GROUP[status];
}

const TONE: Record<ListingStatus, StatusTone> = {
  draft: 'neutral',
  pending_review: 'info',
  rejected: 'danger',
  live: 'ok',
  paused: 'neutral',
  reserved: 'info',
  sold: 'neutral',
  rented: 'info',
  unavailable: 'neutral',
  expired: 'warn',
  hidden: 'danger',
  removed: 'danger',
};

/** The StatusChip of a status: its i18n key (`listing.status.<status>`) and tone. */
export function statusChip(status: ListingStatus): { key: string; tone: StatusTone } {
  return { key: `listing.status.${status}`, tone: TONE[status] };
}

// ─── The manage sheet, the edit menu and the cards (§10; plan Task 27) ───

/** A manage-sheet row: Edit, Update quantity, Find the other side, View listing, Delete draft, or a seller action (§7.2). */
export type ManageItem = 'edit' | 'quantity' | 'other_side' | 'view' | 'delete_draft' | SellerListingAction;

/** What the manage sheet runs through the API: a seller action, or deleting a draft (`DELETE /listings/:id`). */
export type ManageAction = SellerListingAction | 'delete_draft';

const isEditable = (status: ListingStatus): boolean => (EDITABLE_LISTING_STATUSES as readonly ListingStatus[]).includes(status);

/**
 * The manage sheet's rows (§10, mockup "Manage a listing"): Edit and Update quantity while editable, the actions
 * `sellerActions` allows (no Duplicate, decision 8), Find the other side for a left / right part, View listing when
 * asked for (My listings), and Remove last. A removed listing has none.
 */
export function manageItems(
  l: { status: ListingStatus; kind: ListingKind; side: PartSide | null },
  opts: { view?: boolean } = {},
): ManageItem[] {
  if (l.status === 'removed') return [];
  // A draft isn't published yet: it's finished in the wizard or deleted (§5.3).
  if (l.status === 'draft') return ['edit', ...(opts.view ? (['view'] as const) : []), 'delete_draft'];
  const actions = sellerActions(l.status, l.kind);
  const items: ManageItem[] = [];
  if (isEditable(l.status)) items.push('edit', 'quantity');
  items.push(...actions.filter((a) => a !== 'remove'));
  if (l.kind === 'part' && (l.side === 'left' || l.side === 'right')) items.push('other_side');
  if (opts.view) items.push('view');
  if (actions.includes('remove')) items.push('remove');
  return items;
}

/** Destructive actions confirm first (§10). */
export function needsConfirm(action: ManageAction): boolean {
  return action === 'remove' || action === 'mark_sold' || action === 'delete_draft';
}

/**
 * Errors that mean the seller's copy of the listing is out of date (it moved on elsewhere, or is gone): refresh the
 * lists and pages it shows in.
 */
export function isStaleListingError(err: unknown): boolean {
  const code = errorCode(err);
  return code === 'LISTING_TRANSITION_NOT_ALLOWED' || code === 'LISTING_NOT_EDITABLE' || code === 'LISTING_NOT_FOUND';
}

/** After Update quantity: an edit that sent a public listing back to review (an unaccepted flag) says so. */
export function quantityToastKey(before: ListingStatus, after: ListingStatus): string {
  const wasPublic = (PUBLIC_LISTING_STATUSES as readonly ListingStatus[]).includes(before);
  return wasPublic && after === 'pending_review' ? 'listing.manage.sentForReview' : 'listing.quantitySheet.saved';
}

/** The toast after an action: a go-live action the gate sent to review says "Sent to our team for a quick check". */
export function actionToastKey(action: ManageAction, outcome: ListingStatus): string {
  return outcome === 'pending_review' ? 'listing.manage.sentForReview' : `listing.manage.done.${action}`;
}

/** A gate refusal (`400 LISTING_INCOMPLETE`) → the step that fixes its first problem; null for anything else. */
export function gateStep(err: unknown, kind: ListingKind): EditStep | null {
  for (const p of incompleteProblems(err)) {
    const step = stepForProblem(p.field, kind);
    if (step) return step;
  }
  return null;
}

/**
 * Where Edit goes (§10, R43): a draft or rejected listing re-runs the wizard (category can change there); another
 * editable status opens the Edit listing menu (`reserved` too since F6 + F7 §8.3: a quantity edit stays ≥ the stock on
 * hold, `409 QUANTITY_BELOW_HELD`); hidden and removed can't be edited.
 */
export function editEntry(status: ListingStatus): 'wizard' | 'menu' | null {
  if ((CATEGORY_EDITABLE_STATUSES as readonly ListingStatus[]).includes(status)) return 'wizard';
  return isEditable(status) ? 'menu' : null;
}

/**
 * Where the wizard opens a listing Edit sends there (§5.3, R43): a draft at its first incomplete step ("Continue"), a
 * rejected listing at the category step (the seller re-runs the wizard and resubmits). `nodeSides` as `editSections`.
 */
export function wizardStartStep(l: ListingOwnerView, nodeSides: boolean | null): SellStep {
  if (l.status !== 'draft') return 'category';
  const hasSides = nodeSides ?? (l.side === 'left' || l.side === 'right' || l.side === 'pair' || l.needsAttention.some((p) => p.field === 'side'));
  return firstIncompleteStep(l, hasSides);
}

/**
 * The Edit listing menu's sections: the kind's steps, without Category on a published listing (R43), with `side` when
 * the node has sides (`nodeHasSides`; unknown node → when the listing has a side or a nudge asks for one), each
 * marked when a `needsAttention` problem points at it.
 */
export function editSections(
  l: { kind: ListingKind; status: ListingStatus; side: PartSide | null; needsAttention: readonly ListingProblem[] },
  nodeSides: boolean | null,
): { step: EditStep; attention: boolean }[] {
  const hasSides = nodeSides ?? (l.side === 'left' || l.side === 'right' || l.side === 'pair' || l.needsAttention.some((p) => p.field === 'side'));
  const flagged = new Set(l.needsAttention.map((p) => stepForProblem(p.field, l.kind)).filter((s) => s !== null));
  return wizardSteps(l.kind, hasSides)
    .filter((step) => step !== 'category' || editEntry(l.status) === 'wizard')
    .map((step) => ({ step, attention: flagged.has(step) }));
}

/** Whether the category `id` has sides (`effectiveHasSides`), from the active tree; null when it isn't there. */
export function nodeHasSides(tree: readonly CategoryNode[] | null | undefined, id: string | null | undefined): boolean | null {
  if (!tree || !id) return null;
  const stack = [...tree];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.id === id) return n.effectiveHasSides;
    stack.push(...n.children);
  }
  return null;
}

/** The card's chip: "Expiring soon" (warn) inside the reminder window, else the status. */
export function myCardChip(c: Pick<MyListingCard, 'status' | 'expiringSoon'>): { key: string; tone: StatusTone } {
  return c.expiringSoon ? { key: 'listing.mine.expiringSoon', tone: 'warn' } : statusChip(c.status);
}

/** "Expires in 5 days" inside the reminder window, else "Updated 3 days ago". */
export function myCardSubtitle(c: Pick<MyListingCard, 'expiringSoon' | 'expiresAt' | 'refreshedAt' | 'updatedAt'>, now: number = Date.now()): string {
  if (c.expiringSoon && c.expiresAt) return expiresText(c.expiresAt, now);
  return updatedAgo(c.refreshedAt ?? c.updatedAt, now);
}

/** The "Still available?" banner with one-tap Renew (§7.4). */
export function showRenew(c: Pick<MyListingCard, 'expiringSoon' | 'status' | 'kind'>): boolean {
  return c.expiringSoon && sellerActions(c.status, c.kind).includes('renew');
}

/**
 * The card's one-line message: the moderator's on a rejected listing, the hide reason, "In review", a needs-attention
 * nudge, then the first missing score item (not on sold listings).
 */
export function myCardNudge(
  c: Pick<MyListingCard, 'status' | 'moderation' | 'statusReason' | 'needsAttention' | 'scoreMissing'>,
  opts: { videoEnabled: boolean },
): { key: string; values?: Record<string, string> } | null {
  if (c.status === 'rejected') {
    return c.moderation?.note ? { key: 'listing.mine.moderatorSays', values: { note: c.moderation.note } } : { key: 'listing.mine.changesRequested' };
  }
  if (c.status === 'hidden') return c.statusReason ? { key: 'listing.mine.hiddenReason', values: { reason: c.statusReason } } : null;
  if (c.status === 'pending_review') return { key: 'listing.mine.inReview' };
  if (c.needsAttention.length > 0) return { key: 'listing.mine.needsAttention' };
  if (c.status === 'sold') return null;
  // No "Add a video" while the app can't upload one (`videoUploadEnabled()`, amendment 3).
  const first = c.scoreMissing.find((item) => item !== 'video' || opts.videoEnabled);
  return first ? { key: `listing.score.${first}` } : null;
}

/** The owner's note on their listing page: the moderator's message on a rejected listing, or the hide reason. */
export function ownerNote(l: ListingOwnerView): { key: string; values?: Record<string, string> } | null {
  if (l.status !== 'rejected' && l.status !== 'hidden') return null;
  return myCardNudge({ ...l, scoreMissing: [] }, { videoEnabled: false });
}
