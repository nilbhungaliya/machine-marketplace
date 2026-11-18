export type StatusTone = 'green' | 'blue' | 'amber' | 'red' | 'gray';

export const TONE_CLASSES: Record<StatusTone, string> = {
  green: 'bg-green-50 text-green-700',
  blue: 'bg-blue-50 text-blue-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  gray: 'bg-gray-100 text-gray-600',
};

// Listing (F2, A3), enquiry and offer (F6), deal and rental booking (F7), part request (F8), verification and GST review
// (A2), account (A2) and report (A6) statuses.
const TONE_BY_STATUS: Record<string, StatusTone> = {
  live: 'green', sold: 'green', rented: 'green', accepted: 'green', completed: 'green', fulfilled: 'green',
  verified: 'green', approved: 'green', active: 'green', agreed: 'green', confirmed: 'green', returned: 'green',
  actioned: 'green', passed: 'green',
  reserved: 'blue', countered: 'blue', matched: 'blue', replied: 'blue', converted: 'blue', reviewing: 'blue',
  needs_more: 'blue', code_sent: 'blue',
  pending_review: 'amber', pending: 'amber', open: 'amber', disputed: 'amber', requested: 'amber', waiting: 'amber',
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
