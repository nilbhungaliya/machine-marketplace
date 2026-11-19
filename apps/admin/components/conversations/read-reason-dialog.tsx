'use client';

import { toast } from 'sonner';
import type { AdminThreadRead } from '@mpm/shared-types';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { explainReadError, readThread } from '@/lib/conversations-api';

/** Why the admin may open this conversation at all (§16.3): a conversation report or a deal's dispute. */
export interface ReadBasis {
  kind: 'report' | 'dispute';
  /** In words, e.g. "Conversation report: Scam or advance payment". */
  label: string;
}

/**
 * Read a conversation (F6 + F7 spec §16.3, R23): a typed reason (`ADMIN_REASON_MIN`–`MAX`) before
 * `POST /admin/threads/:id/read`; the read is audit-logged with the reason every time. The messages go to `onRead`,
 * which keeps them in component state only (no React Query cache, no storage). Mount it only while open.
 */
export function ReadReasonDialog({ threadId, basis, onClose, onRead }: {
  threadId: string;
  basis: ReadBasis;
  onClose: () => void;
  onRead: (read: AdminThreadRead) => void;
}) {
  return (
    <ReasonDialog
      title="Read this conversation"
      description="Messages are shown as the parties wrote them, with their photos. Contact numbers they shared are never shown."
      label="Why are you reading it?"
      hint="Recorded in the audit log with your name. 3 to 500 characters."
      submitLabel="Read conversation"
      onClose={onClose}
      onSubmit={async (reason) => {
        try {
          onRead(await readThread(threadId, reason));
          return true;
        } catch (err) {
          toast.error(explainReadError(err));
          return false;
        }
      }}
    >
      <p className="rounded-xl bg-brand-50 px-3 py-2 text-[13px] text-gray-700">
        <span className="font-bold text-brand-700">Basis:</span> {basis.label}. Every read is audit-logged.
      </p>
    </ReasonDialog>
  );
}
