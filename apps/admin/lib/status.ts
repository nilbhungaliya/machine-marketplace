import type { ListingStatus, PartRequestStatus } from '@mpm/shared-types';

export type StatusTone = 'green' | 'blue' | 'amber' | 'red' | 'gray';

export const TONE_CLASSES: Record<StatusTone, string> = {
  // Periwinkle v2 (spec §10.2): status colour on its soft fill; `blue` (in progress) is the brand lavender.
  green: 'bg-green-50 text-green-600',
  blue: 'bg-brand-50 text-brand-700',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  gray: 'bg-gray-100 text-gray-600',
};

/**
 * Listing statuses (F2 spec §7.1, ruling (c)): one tone each, typed so a new status can't slip in without one. `hidden`
 * (taken down by a moderator) is red; `expired` (not refreshed in time) is grey, as paused.
 */
export const LISTING_STATUS_TONES: Record<ListingStatus, StatusTone> = {
  draft: 'gray', pending_review: 'amber', rejected: 'red', live: 'green', paused: 'gray', reserved: 'blue', sold: 'green',
  rented: 'green', unavailable: 'gray', expired: 'gray', hidden: 'red', removed: 'gray',
};

/** Listing statuses in words, for the admin's badges, filters and history. */
export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  draft: 'Draft', pending_review: 'Pending review', rejected: 'Rejected', live: 'Live', paused: 'Paused',
  reserved: 'Reserved', sold: 'Sold', rented: 'On rent', unavailable: 'Unavailable', expired: 'Expired', hidden: 'Hidden',
  removed: 'Removed',
};

/**
 * Part request statuses (F8 §14): `active` is in progress (brand lavender), `fulfilled` green, `closed` / `expired`
 * grey, `removed` (taken down by the team) red. Typed so a new status can't slip in without one; the shared
 * `statusTone` map keeps listing tones for `active` / `removed`, so part-request pages use `partRequestStatusTone`.
 */
export const PART_REQUEST_STATUS_TONES: Record<PartRequestStatus, StatusTone> = {
  active: 'blue', fulfilled: 'green', closed: 'gray', expired: 'gray', removed: 'red',
};

export function partRequestStatusTone(status: PartRequestStatus): StatusTone {
  return PART_REQUEST_STATUS_TONES[status];
}

// Listing statuses (above), enquiry and offer (F6), deal and rental booking (F7), part request (F8), verification and GST
// review (A2), account (A2) and report (A6) statuses. A word several domains share (rejected, expired…) keeps one tone.
const TONE_BY_STATUS: Record<string, StatusTone> = {
  ...LISTING_STATUS_TONES,
  accepted: 'green', completed: 'green', fulfilled: 'green',
  verified: 'green', approved: 'green', active: 'green', agreed: 'green', confirmed: 'green', returned: 'green',
  actioned: 'green', passed: 'green',
  countered: 'blue', matched: 'blue', replied: 'blue', converted: 'blue', reviewing: 'blue',
  code_sent: 'blue',
  // needs_more is amber, as the app's orange "Needs more" chip: an open review (its business summary is `pending`,
  // amber) that waits on the business's action.
  pending: 'amber', open: 'amber', disputed: 'amber', requested: 'amber', waiting: 'amber',
  needs_more: 'amber',
  cancelled: 'red', suspended: 'red', banned: 'red', failed: 'red', blocked: 'red', revoked: 'red',
  withdrawn: 'gray', closed: 'gray', dismissed: 'gray', not_submitted: 'gray',
};

/** Wording an admin reads; anything not listed is the status with underscores as spaces, first letter capital. */
const LABELS: Record<string, string> = {
  hidden: 'Hidden',
  expired: 'Expired',
  pending_review: 'Pending review',
  not_submitted: 'Not submitted',
};

export function statusTone(status: string): StatusTone {
  return TONE_BY_STATUS[status] ?? 'gray';
}

export function statusLabel(status: string): string {
  if (LABELS[status]) return LABELS[status];
  const s = status.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
