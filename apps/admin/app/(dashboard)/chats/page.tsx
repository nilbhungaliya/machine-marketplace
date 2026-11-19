'use client';

import { ConversationReportsTable } from '@/components/conversations/conversation-reports-table';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Conversations (F6 + F7 spec §16.1): reported conversations only. Messages are private: a conversation opens only
 * with a report (or, for support, a dispute) and a typed reason, and every read is audit-logged (§16.3).
 */
export default function ConversationsPage() {
  return (
    <div>
      <PageHeader
        title="Conversations"
        description="Reported conversations. Reading one needs a reason and is recorded in the audit log; suspend or block a business from its page."
      />
      <ConversationReportsTable />
    </div>
  );
}
