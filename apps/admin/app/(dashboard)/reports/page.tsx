'use client';

import { ConversationReportsTable } from '@/components/conversations/conversation-reports-table';
import { ReviewReportsTable } from '@/components/reviews/review-reports-table';
import { PageHeader } from '@/components/ui/page-header';
import { RecordTabs } from '@/components/ui/record-tabs';

type Tab = 'conversations' | 'reviews';

/**
 * Reports & flags (F6 + F7 spec §16.1): conversation reports (shared with Conversations) and review reports, where
 * moderators hide a review or its reply. Listing reports stay in Listing moderation (F2).
 */
export default function ReportsPage() {
  return (
    <div>
      <PageHeader
        title="Reports & flags"
        description="Reported conversations and reviews. Reported listings are in Listing moderation."
      />
      <RecordTabs<Tab>
        items={[
          { value: 'conversations', label: 'Conversations' },
          { value: 'reviews', label: 'Reviews' },
        ]}
        panels={{
          conversations: () => <ConversationReportsTable />,
          reviews: () => <ReviewReportsTable />,
        }}
      />
    </div>
  );
}
