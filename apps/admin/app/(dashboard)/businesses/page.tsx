'use client';

import { BusinessTable } from '@/components/businesses/business-table';
import { PageHeader } from '@/components/ui/page-header';

/** A2 Users & businesses (F1 + A2 spec §8.2). */
export default function BusinessesPage() {
  return (
    <div>
      <PageHeader
        title="Users & businesses"
        description="Every registered business and its people. Open one to see its profile, GST history and account actions."
      />
      <BusinessTable />
    </div>
  );
}
