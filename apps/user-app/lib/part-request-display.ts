import { isMatched, requestSideAccepts, type PartRequestStatus, type PartSide } from '@mpm/shared-types';
import type { StatusTone } from '@/components/StatusChip';

// How a part request shows (F8 spec §13.3; mockup "My requirements", "Replies and matches"). Pure; copy keys under
// `requirements.*`.

const TONES: Record<PartRequestStatus, StatusTone> = {
  active: 'info',
  fulfilled: 'ok',
  closed: 'neutral',
  expired: 'warn',
  removed: 'danger',
};

/** The status chip's tone. */
export function requestStatusTone(status: PartRequestStatus): StatusTone {
  return TONES[status];
}

/** The status chip's copy key. */
export function requestStatusKey(status: PartRequestStatus): string {
  return `requirements.status.${status}`;
}

/** The "Matched" badge's key, or null (R3: a delivered reply or an auto match). */
export function matchedBadge(v: { deliveredReplyCount: number; matchCount: number }): string | null {
  return isMatched(v) ? 'requirements.matched' : null;
}

/** "n days left" (`count` for the plural), "Expires today" at 0 or below. */
export function daysLeftKey(days: number): { key: string; count?: number } {
  return days > 0 ? { key: 'requirements.daysLeft', count: days } : { key: 'requirements.expiresToday' };
}

const SIDES: readonly PartSide[] = ['left', 'right', 'pair'];

/** The sides a request accepts (`requestSideAccepts`), as `listing.side.*` keys; empty when it takes any side. */
export function sideAcceptKeys(side: PartSide | null): string[] {
  if (side === null || side === 'not_applicable') return [];
  return SIDES.filter((s) => requestSideAccepts(side, s)).map((s) => `listing.side.${s}`);
}
