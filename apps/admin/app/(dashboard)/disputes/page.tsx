'use client';

import { DisputesTable } from '@/components/disputes/disputes-table';
import { PageHeader } from '@/components/ui/page-header';

/** Disputes (F6 + F7 spec §9.6, §16.1): support's queue of problems reported on deals. */
export default function DisputesPage() {
  return (
    <div>
      <PageHeader
        title="Disputes"
        description="Problems reported on deals, open first and oldest first. Open one to read the problem, the deal and, with a reason, the conversation."
      />
      <DisputesTable />
    </div>
  );
}
