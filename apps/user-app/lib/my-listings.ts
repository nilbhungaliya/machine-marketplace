import type { ListingStatus, MyListingsGroup } from '@mpm/shared-types';
import type { StatusTone } from '@/components/StatusChip';

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
