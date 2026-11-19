'use client';

import { DealsTable } from '@/components/deals/deals-table';
import { PageHeader } from '@/components/ui/page-header';

/** Deals (F6 + F7 spec §16.1): every deal by status. Read-only; disputes are decided in Disputes. */
export default function DealsPage() {
  return (
    <div>
      <PageHeader
        title="Deals"
        description="Agreed, handed over, disputed, completed and cancelled deals. Payment happens off the platform; this is the shared record."
      />
      <DealsTable />
    </div>
  );
}
