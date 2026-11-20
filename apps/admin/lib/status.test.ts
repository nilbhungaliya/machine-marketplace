import { describe, expect, it } from 'vitest';
import { statusTone } from './status';

describe('statusTone', () => {
  it('a GST review waiting for more files is amber, as the app’s orange "Needs more" chip', () => {
    expect(statusTone('needs_more')).toBe('amber');
    expect(statusTone('waiting')).toBe('amber');
    expect(statusTone('pending')).toBe('amber');
  });

  it('decided reviews: approved green, rejected red; unknown gray', () => {
    expect(statusTone('approved')).toBe('green');
    expect(statusTone('rejected')).toBe('red');
    expect(statusTone('something_new')).toBe('gray');
  });
});

describe('listing statuses (F2 spec §7.1, ruling (c))', () => {
  it('every listing status has its own tone and label, hidden and expired included', async () => {
    const { LISTING_STATUSES } = await import('@mpm/shared-types');
    const { LISTING_STATUS_TONES, LISTING_STATUS_LABELS, statusLabel } = await import('./status');
    for (const s of LISTING_STATUSES) {
      expect(LISTING_STATUS_TONES[s], s).toBeDefined();
      expect(LISTING_STATUS_LABELS[s], s).toBeTruthy();
    }
    expect(statusLabel('hidden')).toBe('Hidden');
    expect(statusLabel('expired')).toBe('Expired');
  });

  it('hidden is red (taken down), expired grey, pending review amber, live green', () => {
    expect(statusTone('hidden')).toBe('red');
    expect(statusTone('expired')).toBe('gray');
    expect(statusTone('pending_review')).toBe('amber');
    expect(statusTone('live')).toBe('green');
  });
});

describe('rental booking statuses (M14 §6.1)', () => {
  it('every status has its tone and label: open amber, running brand, completed green, ended gray, disputed red', async () => {
    const { RENTAL_BOOKING_STATUSES } = await import('@mpm/shared-types');
    const { RENTAL_BOOKING_STATUS_TONES, RENTAL_BOOKING_STATUS_LABELS, rentalBookingStatusTone } = await import('./status');
    for (const s of RENTAL_BOOKING_STATUSES) expect(RENTAL_BOOKING_STATUS_LABELS[s], s).toBeTruthy();
    expect(RENTAL_BOOKING_STATUS_TONES).toEqual({
      requested: 'amber', countered: 'amber', confirmed: 'blue', on_rent: 'blue', returned: 'blue', completed: 'green',
      declined: 'gray', withdrawn: 'gray', expired: 'gray', cancelled: 'gray', disputed: 'red',
    });
    // The shared map keeps its deal / offer tones for the same words; booking pages use the rental helper.
    expect(rentalBookingStatusTone('cancelled')).toBe('gray');
    expect(statusTone('cancelled')).toBe('red');
  });
});
