'use client';

import { EnquiriesTable } from '@/components/enquiries/enquiries-table';
import { PageHeader } from '@/components/ui/page-header';

/** Enquiries & offers (F6 + F7 spec §16.1): a read-only monitor of every conversation and its negotiation. */
export default function EnquiriesPage() {
  return (
    <div>
      <PageHeader
        title="Enquiries & offers"
        description="Every conversation with its open negotiation. Read-only: no message or note text is shown here."
      />
      <EnquiriesTable />
    </div>
  );
}
