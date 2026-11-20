'use client';

import Link from 'next/link';
import type { AdminRentalBookingRow, RentalBlockView } from '@mpm/shared-types';
import StatusBadge from '@/components/status-badge';
import { Panel } from '@/components/ui/panel';
import { useAuth } from '@/lib/auth-context';
import { formatPaise } from '@/lib/listings-api';
import { RENTAL_BLOCK_REASON_LABELS, formatBookingRef, formatDayRange } from '@/lib/rentals-api';
import { RENTAL_BOOKING_STATUS_LABELS, rentalBookingStatusTone } from '@/lib/status';
import { RENTAL_ACTION_ROLES } from './cancel-booking-dialog';

/**
 * A rental listing's bookings (newest start first, up to 100) and the owner's calendar blocks (M14 spec §15), on the
 * admin listing page. A booking opens in Rental bookings for the roles that see it; "All bookings" opens the list
 * filtered to this listing.
 */
export function ListingRentalBlock({ listingId, rental }: {
  listingId: string;
  rental: { bookings: AdminRentalBookingRow[]; blocks: RentalBlockView[] };
}) {
  const canOpen = useAuth().hasRole(...RENTAL_ACTION_ROLES);
  const { bookings, blocks } = rental;

  return (
    <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
      <Panel
        title={`Bookings (${bookings.length}${bookings.length >= 100 ? '+' : ''})`}
        action={canOpen && bookings.length > 0 && (
          <Link href={`/rentals/?listingId=${listingId}`} className="text-sm font-bold text-brand-700 hover:underline">All bookings</Link>
        )}
      >
        {bookings.length === 0 ? (
          <p className="text-sm text-gray-500">No booking requests yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                {canOpen
                  ? <Link href={`/rentals/${b.id}/`} className="font-mono font-semibold text-brand-700 hover:underline">{formatBookingRef(b.ref)}</Link>
                  : <span className="font-mono font-semibold text-gray-900">{formatBookingRef(b.ref)}</span>}
                <span className="max-w-[12rem] truncate text-gray-700">{b.renter.name}</span>
                <span className="text-gray-600 tnum">{formatDayRange(b.startDate, b.endDate)} · {b.machines} machine{b.machines === 1 ? '' : 's'}</span>
                <StatusBadge status={b.status} label={RENTAL_BOOKING_STATUS_LABELS[b.status]} tone={rentalBookingStatusTone(b.status)} />
                <span className="ml-auto text-gray-700 tnum">{b.agreedTotalPaise !== null ? formatPaise(b.agreedTotalPaise) : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Calendar blocks (${blocks.length})`}>
        {blocks.length === 0 ? (
          <p className="text-sm text-gray-500">The owner hasn&apos;t blocked any dates.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {blocks.map((k) => (
              <li key={k.id} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-semibold text-gray-900 tnum">{formatDayRange(k.startDate, k.endDate)}</span>
                  <span className="text-gray-600">{RENTAL_BLOCK_REASON_LABELS[k.reason]}</span>
                  <span className="ml-auto text-gray-600 tnum">{k.machines} machine{k.machines === 1 ? '' : 's'}</span>
                </div>
                {k.note && <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-gray-600">{k.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
