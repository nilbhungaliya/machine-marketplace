'use client';

import { PartRequestsTable } from '@/components/part-requests/part-requests-table';
import { PageHeader } from '@/components/ui/page-header';

/** Part requests (F8 spec §14): every buyer requirement; open one to see who was told, the replies, matches and reports. */
export default function PartRequestsPage() {
  return (
    <div>
      <PageHeader
        title="Part requests"
        description="Requirements buyers posted, active first. Search by buyer business or owner phone; open one to remove or restore it."
      />
      <PartRequestsTable />
    </div>
  );
}
