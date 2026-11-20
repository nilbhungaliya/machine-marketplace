'use client';

import { DisputesTable } from '@/components/disputes/disputes-table';
import { PageHeader } from '@/components/ui/page-header';

/** Disputes (F6 + F7 spec §9.6, §16.1; M14 R12): support's queue of problems reported on deals and rental bookings. */
export default function DisputesPage() {
  return (
    <div>
      <PageHeader
        title="Disputes"
        description="Problems reported on deals and rental bookings, open first and oldest first. Open one to read the problem, the deal or booking and, with a reason, the conversation."
      />
      <DisputesTable />
    </div>
  );
}
