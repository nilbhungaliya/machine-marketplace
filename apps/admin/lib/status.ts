export type StatusTone = 'green' | 'blue' | 'amber' | 'red' | 'gray';

export const TONE_CLASSES: Record<StatusTone, string> = {
  // Periwinkle v2 (spec §10.2): status colour on its soft fill; `blue` (in progress) is the brand lavender.
  green: 'bg-green-50 text-green-600',
  blue: 'bg-brand-50 text-brand-700',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  gray: 'bg-gray-100 text-gray-600',
};

// Listing (F2, A3), enquiry and offer (F6), deal and rental booking (F7), part request (F8), verification and GST review
// (A2), account (A2) and report (A6) statuses.
const TONE_BY_STATUS: Record<string, StatusTone> = {
  live: 'green', sold: 'green', rented: 'green', accepted: 'green', completed: 'green', fulfilled: 'green',
  verified: 'green', approved: 'green', active: 'green', agreed: 'green', confirmed: 'green', returned: 'green',
  actioned: 'green', passed: 'green',
  reserved: 'blue', countered: 'blue', matched: 'blue', replied: 'blue', converted: 'blue', reviewing: 'blue',
  code_sent: 'blue',
  // needs_more is amber, as the app's orange "Needs more" chip: an open review (its business summary is `pending`,
  // amber) that waits on the business's action.
  pending_review: 'amber', pending: 'amber', open: 'amber', disputed: 'amber', requested: 'amber', waiting: 'amber',
  needs_more: 'amber',
  rejected: 'red', cancelled: 'red', suspended: 'red', banned: 'red', failed: 'red', blocked: 'red', revoked: 'red',
  draft: 'gray', paused: 'gray', expired: 'gray', removed: 'gray', withdrawn: 'gray', closed: 'gray',
  unavailable: 'gray', dismissed: 'gray', not_submitted: 'gray',
};

/** Wording an admin reads; anything not listed is the status with underscores as spaces, first letter capital. */
const LABELS: Record<string, string> = {
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
