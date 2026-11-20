/**
 * Plain-words labels for the audit log's action codes (admin close-out §11.3; ported from textile
 * `services/admin-insights/audit-labels.ts`). `AUDIT_LABELS` covers every action the API writes today (`writeAudit`,
 * the dynamic `listing.${…}`, `review.${…}` and `user.${…}` expanded) plus this feature's (plan D15); an action with no
 * label shows its code. Add a label with each new audited action.
 */
export const AUDIT_LABELS: Record<string, string> = {
  // Admin users and sessions (AD7, plan D15)
  'admin_user.create': 'Admin invited',
  'admin_user.update': 'Admin edited',
  'admin_user.deactivate': 'Admin deactivated',
  'admin_user.reactivate': 'Admin reactivated',
  'admin_user.password_link': 'Password link issued',
  'admin_user.sign_out': 'Admin signed out everywhere',
  'admin_user.password_set': 'Password set from a link',
  'admin_user.password_change': 'Password changed',
  'audit.reveal': 'Audit entry shown unmasked',
  'export.create': 'CSV exported',

  // Settings
  'setting.update': 'Setting changed',

  // Catalogue (A4)
  'category.create': 'Category created',
  'category.update': 'Category edited',
  'category.move': 'Category moved',
  'category.reorder': 'Categories reordered',
  'category.delete': 'Category deleted',
  'field.create': 'Field created',
  'field.update': 'Field edited',
  'field.reorder': 'Fields reordered',
  'option.create': 'Option created',
  'option.update': 'Option edited',
  'option.reorder': 'Options reordered',
  'brand.create': 'Brand created',
  'brand.update': 'Brand edited',
  'brand.reorder': 'Brands reordered',
  'brand.delete': 'Brand deleted',
  'model.create': 'Model created',
  'model.update': 'Model edited',
  'model.move': 'Model moved to another brand',
  'model.reorder': 'Models reordered',
  'model.delete': 'Model deleted',
  'unit.create': 'Unit created',
  'unit.update': 'Unit edited',
  'unit.reorder': 'Units reordered',
  'condition.create': 'Condition created',
  'condition.update': 'Condition edited',
  'condition.reorder': 'Conditions reordered',
  'industrial_area.create': 'Industrial area added',
  'industrial_area.update': 'Industrial area edited',
  'industrial_area.reorder': 'Industrial areas reordered',
  'industrial_area.delete': 'Industrial area deleted',
  'industrial_area.adopt': '"Other" area adopted into the list',

  // Search (F4 + F5)
  'search_synonym.create': 'Search synonym added',
  'search_synonym.update': 'Search synonym edited',
  'search_synonym.delete': 'Search synonym deleted',
  'search_trending.hide': 'Trending search hidden',
  'search_trending.unhide': 'Trending search shown again',

  // Users, businesses and GST verification (F1 + A2)
  'user.suspend': 'User suspended',
  'user.reinstate': 'User reinstated',
  'user.block': 'User blocked',
  'user.unblock': 'User unblocked',
  'gst.revoke': 'GST verification revoked',
  'gst.release': 'GSTIN released',
  'gst_review.approve': 'GST review approved',
  'gst_review.reject': 'GST review rejected',
  'gst_review.ask_for_more': 'GST review: more documents asked for',
  'gst_document.view': 'GST document opened',

  // Listings (F2 + A3)
  'listing.approve': 'Listing approved',
  'listing.ask_for_changes': 'Listing changes asked for',
  'listing.reject': 'Listing rejected',
  'listing.hide': 'Listing hidden',
  'listing.unhide': 'Listing shown again',
  'listing.remove': 'Listing removed',
  'listing.edit': 'Listing edited by the team',
  'listing_media.delete': 'Listing photo or video deleted',
  'listing_reports.resolve': 'Listing reports resolved',

  // Reports, reviews, conversations and fraud signals (F6 + F7, AD6)
  'report.resolve': 'Report resolved',
  'review.hide': 'Review hidden',
  'review.unhide': 'Review shown again',
  'review.hide_reply': 'Review reply hidden',
  'thread.read': 'Conversation read',
  'fraud_signal.review': 'Fraud signal reviewed',

  // Deals, rentals and part requests
  'deal.dispute_resolve': 'Deal dispute resolved',
  'rental_booking.cancel': 'Rental booking cancelled by the team',
  'rental_booking.dispute_resolve': 'Rental dispute resolved',
  'part_request.remove': 'Requirement removed',
  'part_request.restore': 'Requirement restored',
};

/** Every action code the API writes (the audit log's action filter offers these). */
export const KNOWN_AUDIT_ACTIONS: readonly string[] = Object.keys(AUDIT_LABELS);

/** The label for an action, or its code when it has none. */
export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action;
}

/** The admin page for an entity, for the entity types that have one. */
export function auditHref(entityType: string, entityId: string | null): string | null {
  if (entityId === null || entityId === '') return null;
  const id = encodeURIComponent(entityId);
  switch (entityType) {
    case 'listing':
      return `/listings/${id}`;
    case 'business':
      return `/businesses/${id}`;
    case 'deal':
      return `/deals/${id}`;
    case 'rental_booking':
      return `/rentals/${id}`;
    case 'part_request':
      return `/part-requests/${id}`;
    case 'admin_user':
      return `/admin-users?id=${id}`;
    case 'category':
      return `/categories?node=${id}`;
    case 'brand':
      return `/brands-models?brand=${id}`;
    case 'model':
      return '/brands-models';
    default:
      return null;
  }
}

