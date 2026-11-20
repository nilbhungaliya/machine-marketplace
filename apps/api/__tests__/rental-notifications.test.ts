import { describe, expect, it } from 'vitest';
import { LANGUAGES, NOTIFICATION_TYPES, type NotificationType } from '@mpm/shared-types';
import type { notifications } from '../src/db/schema.js';
import { pushMessageFor } from '../src/services/notifications/push-sender.js';
import { renderNotification } from '../src/services/notifications/render.js';

// M14 A3-3 (spec §11, R14, §18): every rental booking notification renders in en / hi / gu with no placeholder left,
// no amount and no contact number planted in the listing title or the business name; a booking's pushes share the tag
// `rental:<bookingId>` and carry its id. Pure: no database.

const RENTAL_TYPES = NOTIFICATION_TYPES.filter((t): t is NotificationType => t.startsWith('rental_booking_'));

/** What `notifyBooking` stores, with a phone number planted in the title and the counterpart's trade name. */
const PARAMS = {
  bookingRef: 700123,
  listingId: '00000000-0000-4000-8000-000000000001',
  listingTitle: 'JCB 3DX backhoe call 9876543210',
  startDate: '2026-11-21',
  endDate: '2026-11-23',
  businessId: '00000000-0000-4000-8000-000000000002',
  businessName: 'Ravi Rentals ९८७६५ ४३२१०',
};

describe('rental notification texts (§11)', () => {
  it('has a text of its own for each of the 17 types', () => {
    expect(RENTAL_TYPES).toHaveLength(17);
    const titles = new Set(RENTAL_TYPES.map((t) => renderNotification(t, PARAMS, 'en').title));
    expect(titles.size).toBe(17);
  });

  it.each(LANGUAGES)('renders every type in %s without placeholders, amounts or the planted numbers', (lang) => {
    for (const type of RENTAL_TYPES) {
      const { title, body } = renderNotification(type, PARAMS, lang);
      const text = `${title}\n${body}`;
      expect(title.length, type).toBeGreaterThan(0);
      expect(body.length, type).toBeGreaterThan(0);
      expect(text, type).not.toMatch(/[{}]|undefined|null|NaN/);
      expect(text, type).not.toContain('₹');
      expect(text, type).not.toMatch(/9876543210|९८७६५/);
    }
    // The ref and the dates reach the texts that name them.
    expect(renderNotification('rental_booking_problem', PARAMS, lang).body).toContain('#700123');
    expect(renderNotification('rental_booking_confirmed', PARAMS, lang).body).toMatch(/21/);
  });

  it('words a rental review by its booking', () => {
    const { body } = renderNotification('review_waiting', { businessName: 'Ravi Rentals', listingTitle: 'JCB', bookingRef: 700123 }, 'en');
    expect(body).toContain('booking #700123');
  });

  it('tags a booking push rental:<id> and carries the booking id', () => {
    const row = {
      id: '00000000-0000-4000-8000-0000000000aa',
      type: 'rental_booking_confirmed',
      params: PARAMS,
      unreadCount: 1,
      threadId: '00000000-0000-4000-8000-0000000000bb',
      offerId: null,
      dealId: null,
      reviewId: null,
      partRequestId: null,
      rentalBookingId: '00000000-0000-4000-8000-0000000000cc',
    } as unknown as typeof notifications.$inferSelect;
    const msg = pushMessageFor(row, { version: 1 }, 'token', 'en');
    expect(msg.tag).toBe('rental:00000000-0000-4000-8000-0000000000cc');
    expect(msg.data).toMatchObject({ type: 'rental_booking_confirmed', rentalBookingId: '00000000-0000-4000-8000-0000000000cc' });
    expect(`${msg.title} ${msg.body}`).not.toMatch(/₹|9876543210/);
  });
});
