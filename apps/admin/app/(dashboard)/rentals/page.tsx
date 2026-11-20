'use client';

import { RentalsTable } from '@/components/rentals/rentals-table';
import { PageHeader } from '@/components/ui/page-header';

/** Rental bookings (M14 spec §15, R15): every machinery booking; open one for its terms, timeline and Cancel booking. */
export default function RentalsPage() {
  return (
    <div>
      <PageHeader
        title="Rental bookings"
        description="Machinery booking requests and bookings, newest change first. Search by booking #ref, business or machine; open one to see its terms and timeline."
      />
      <RentalsTable />
    </div>
  );
}
