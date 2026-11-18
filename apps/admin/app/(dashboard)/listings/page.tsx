'use client';

import { ListingsTable } from '@/components/listings/listings-table';
import { PageHeader } from '@/components/ui/page-header';

/** A3 Parts & machinery (F2 spec §11.4): every listing in every status but drafts; the sold / unavailable monitor is the status filter. */
export default function ListingsPage() {
  return (
    <div>
      <PageHeader
        title="Parts & machinery"
        description="Every listing across every status. Search by title, part number, #ref or business; open one to review it, hide it or remove it."
      />
      <ListingsTable />
    </div>
  );
}
