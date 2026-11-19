import type { NotificationType } from '@mpm/shared-types';

/**
 * What a notification's text may use (F6 + F7 spec §11.4), already made safe by `render.ts`: business names and listing
 * titles masked (`maskContact`), the price formatted in Indian grouping, the due date on the India calendar. Never
 * message text, notes, phone numbers, emails, review text, OTPs or GST details.
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
  /** A due date (`review_waiting`) as "3 Dec" in the reader's language; '' when none. */
  dueOn: string;
  /** Grouped chat rows: messages since the row opened (≥ 1). */
  count: number;
}

export interface RenderedText {
  title: string;
  body: string;
}

/** A missing translation is a type error. */
export type NotificationTexts = Record<NotificationType, (p: TextParams) => RenderedText>;
