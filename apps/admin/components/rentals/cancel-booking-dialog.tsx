'use client';

import { useState } from 'react';
import { Ban } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminRentalBookingDetail } from '@mpm/shared-types';
import { Button } from '@/components/ui/button';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { useAuth } from '@/lib/auth-context';
import { ADMIN_CANCELLABLE, cancelRentalBooking, explainRentalError, formatBookingRef } from '@/lib/rentals-api';

/** What the dialog needs of the booking. */
export type CancelBookingTarget = Pick<AdminRentalBookingDetail, 'id' | 'ref' | 'status' | 'renter' | 'owner'>;

/** The roles that may cancel (the API's `requireAdminRole('operations', 'support')`; super_admin passes). */
export const RENTAL_ACTION_ROLES = ['operations', 'support'] as const;

/**
 * Cancel a booking (M14 spec §6.1 admin cancel, §15, R15) with a reason (3–500, audit-logged, never shown to the
 * parties). Both businesses are told, the dates are freed on the owner's calendar. Only while requested, countered or
 * confirmed: once the machine is on site only a dispute settles it. Mount it only while open.
 */
export function CancelBookingDialog({ booking, onClose, onDone }: {
  booking: CancelBookingTarget;
  onClose: () => void;
  /** After the cancel, or a refusal that means the booking changed meanwhile (null): reload. */
  onDone: (next: AdminRentalBookingDetail | null) => void;
}) {
  const ref = formatBookingRef(booking.ref);
  return (
    <ReasonDialog
      title={`Cancel booking ${ref}`}
      description={`The booking ends at once and its dates are freed on the owner's calendar. ${booking.renter.name} (renter) and ${booking.owner.name} (owner) are both told the team cancelled it, without your reason.`}
      hint="Stays with staff and in the audit log. 3 to 500 characters."
      submitLabel="Cancel booking"
      submitVariant="danger"
      onClose={onClose}
      onSubmit={async (reason) => {
        try {
          const next = await cancelRentalBooking(booking.id, { reason });
          toast.success(`Booking ${ref} cancelled`);
          onDone(next);
          return true;
        } catch (err) {
          const { message, stale } = explainRentalError(err);
          toast.error(message);
          if (!stale) return false;
          onDone(null);
          return true;
        }
      }}
    />
  );
}

/** "Cancel booking" for the roles that may, while the status allows it; nothing otherwise. */
export function CancelBookingButton({ booking, onDone }: {
  booking: CancelBookingTarget;
  onDone: (next: AdminRentalBookingDetail | null) => void;
}) {
  const { hasRole } = useAuth();
  const [open, setOpen] = useState(false);
  if (!hasRole(...RENTAL_ACTION_ROLES) || !ADMIN_CANCELLABLE.includes(booking.status)) return null;
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}><Ban size={15} aria-hidden /> Cancel booking</Button>
      {open && <CancelBookingDialog booking={booking} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}
