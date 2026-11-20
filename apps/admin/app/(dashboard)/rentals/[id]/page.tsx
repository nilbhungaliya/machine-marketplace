'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { AdminRentalBookingDetail } from '@mpm/shared-types';
import { CancelBookingButton } from '@/components/rentals/cancel-booking-dialog';
import { RentalDetail } from '@/components/rentals/rental-detail';
import StatusBadge from '@/components/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { useBackTarget } from '@/lib/back-link';
import { classifyLoadError } from '@/lib/load-error';
import { fetchAdminRental, formatBookingRef } from '@/lib/rentals-api';
import { getAdminSocket } from '@/lib/socket';
import { RENTAL_BOOKING_STATUS_LABELS, rentalBookingStatusTone } from '@/lib/status';

const LOAD_MESSAGES = {
  not_found: 'This booking does not exist.',
  forbidden: "Your role can't open rental bookings.",
  failed: 'Check your connection and try again.',
};

/** One rental booking (M14 spec §15, R15), with Cancel booking in the header while it can be cancelled. */
export default function RentalPage() {
  const { id } = useParams<{ id: string }>();
  const back = useBackTarget({ href: '/rentals/', label: 'Rental bookings' });
  const [booking, setBooking] = useState<AdminRentalBookingDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchAdminRental(id);
      if (ticket !== latest.current) return;
      setBooking(next);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // `rental:updated` { bookingId } (§12): reload when this booking moved.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    const socket = getAdminSocket();
    const onUpdated = (payload: { bookingId?: string } = {}) => {
      if (!payload?.bookingId || payload.bookingId === id) void loadRef.current();
    };
    socket.on('rental:updated', onUpdated);
    return () => { socket.off('rental:updated', onUpdated); };
  }, [id]);

  if (!booking || booking.id !== id) {
    return error ? (
      <ErrorState title="Couldn't open this booking" message={LOAD_MESSAGES[classifyLoadError(error)]} onRetry={() => void load()} />
    ) : (
      <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={6} cols={3} /></div>
    );
  }

  const ref = formatBookingRef(booking.ref);

  return (
    <div>
      <PageHeader
        back={back}
        trail={[ref]}
        title={booking.listing.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>Booking <span className="font-mono">{ref}</span> · {booking.renter.name} (renter) from {booking.owner.name} (owner)</span>
            <StatusBadge status={booking.status} label={RENTAL_BOOKING_STATUS_LABELS[booking.status]} tone={rentalBookingStatusTone(booking.status)} />
          </span>
        }
        actions={(
          <CancelBookingButton
            booking={booking}
            onDone={(next) => {
              // A refusal that means the booking changed meanwhile answers null: reload it.
              if (next) setBooking(next);
              else void load();
            }}
          />
        )}
      />
      {error !== null && <StaleWarning thing="booking" onRetry={() => void load()} />}
      <RentalDetail booking={booking} />
    </div>
  );
}
