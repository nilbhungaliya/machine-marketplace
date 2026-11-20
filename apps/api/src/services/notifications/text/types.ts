import type { NotificationType, PartRequestDropReason } from '@mpm/shared-types';

/**
 * What a notification's text may use (F6 + F7 spec §11.4), already made safe by `render.ts`: business names and listing
 * titles masked (`maskContact`), the price formatted in Indian grouping, the due date on the India calendar. Never
 * message text, notes, phone numbers, emails, review text, OTPs or GST details; for F8 never the request note, a reply
 * message, the budget, a pincode or an address.
 */
export interface TextParams {
  /** The other business's trade name (masked); '' when unknown. */
  businessName: string;
  /** The listing title (masked); '' when unknown. */
  listingTitle: string;
  /** Price per unit, `₹1,23,456` or `₹99.50`; '' when none. */
  price: string;
  /** Quantity with its unit (`5 pieces`); '' when none. */
  quantity: string;
  /** Deal ref `#500001`; '' when none. */
  dealRef: string;
  /** A due date (`review_waiting`, F8 expiring / expired) as "3 Dec" in the reader's language; '' when none. */
  dueOn: string;
  /** `dueAt` is at or before the time of rendering (F8 `part_request_expired`: no renew left); false when none. */
  duePassed: boolean;
  /** Grouped rows (chat, F8 replies and matches): events since the row opened (≥ 1). */
  count: number;
  /** F8 (spec §10.3): the request name, masked; '' when unknown. */
  requestTitle: string;
  /** F8: the request's side key (`left` / `right` / `pair`), localised by the template; '' when none. */
  side: '' | 'left' | 'right' | 'pair';
  /** F8: the match's stored snapped whole km as digits; '' when none. Never a raw distance. */
  distanceKm: string;
  /** F8: the request's city (masked); '' when unknown. Never a pincode or address. */
  city: string;
  /** F8 `part_request_reply_dropped`: the drop reason code, localised by the template; '' when unknown. */
  reason: '' | PartRequestDropReason;
}

export interface RenderedText {
  title: string;
  body: string;
}

/** A missing translation is a type error. */
export type NotificationTexts = Record<NotificationType, (p: TextParams) => RenderedText>;
