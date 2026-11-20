'use client';

import { ConversationReportsTable } from '@/components/conversations/conversation-reports-table';
import { PartRequestReportsTable } from '@/components/part-requests/part-request-reports';
import { ReviewReportsTable } from '@/components/reviews/review-reports-table';
import { PageHeader } from '@/components/ui/page-header';
import { RecordTabs } from '@/components/ui/record-tabs';

type Tab = 'conversations' | 'reviews' | 'part_requests';

/**
 * Reports & flags (F6 + F7 spec §16.1): conversation reports (shared with Conversations) and review reports, where
 * moderators hide a review or its reply, and part-request reports (F8 spec §14), which link to the requirement's page
 * (Remove lives there). Listing reports stay in Listing moderation (F2).
 */
export default function ReportsPage() {
  return (
    <div>
      <PageHeader
        title="Reports & flags"
        description="Reported conversations, reviews and part requests. Reported listings are in Listing moderation."
      />
      <RecordTabs<Tab>
        items={[
          { value: 'conversations', label: 'Conversations' },
          { value: 'reviews', label: 'Reviews' },
          { value: 'part_requests', label: 'Part requests' },
        ]}
        panels={{
          conversations: () => <ConversationReportsTable />,
          reviews: () => <ReviewReportsTable />,
          part_requests: () => <PartRequestReportsTable />,
        }}
      />
    </div>
  );
}
