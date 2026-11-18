'use client';

import { toast } from 'sonner';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { ApiError } from '@/lib/api';
import {
  REASON_MAX, REASON_MIN, changeUserStatus, releaseGstin, revokeGst, type UserStatusAction,
} from '@/lib/businesses-api';

/** An account or GST action on the business page; every one needs a reason (F1 + A2 spec §5.4, §8.2). */
export type StatusAction =
  | { kind: UserStatusAction; userId: string; name: string }
  | { kind: 'revoke' | 'release'; businessId: string; name: string };

const COPY: Record<StatusAction['kind'], { title: (name: string) => string; description: string; submit: string; done: string }> = {
  suspend: {
    title: (n) => `Suspend ${n}`,
    description: 'They are signed out at once and can’t sign in until reinstated.',
    submit: 'Suspend',
    done: 'Account suspended',
  },
  reinstate: {
    title: (n) => `Reinstate ${n}`,
    description: 'They can sign in again.',
    submit: 'Reinstate',
    done: 'Account reinstated',
  },
  block: {
    title: (n) => `Block ${n}`,
    description: 'They are signed out at once. Only a super admin can unblock them.',
    submit: 'Block',
    done: 'Account blocked',
  },
  unblock: {
    title: (n) => `Unblock ${n}`,
    description: 'They can sign in again.',
    submit: 'Unblock',
    done: 'Account unblocked',
  },
  revoke: {
    title: (n) => `Revoke GST of ${n}`,
    description:
      'The GST badge goes and the business sees this reason. It keeps its GSTIN, and from now on it can only verify again through an officer review.',
    submit: 'Revoke GST',
    done: 'GST verification revoked',
  },
  release: {
    title: (n) => `Release the GSTIN of ${n}`,
    description: 'The GSTIN and its GST details are cleared, so another business can verify it.',
    submit: 'Release GSTIN',
    done: 'GSTIN released',
  },
};

function run(action: StatusAction, reason: string): Promise<unknown> {
  if ('userId' in action) return changeUserStatus(action.userId, action.kind, reason);
  return action.kind === 'revoke' ? revokeGst(action.businessId, reason) : releaseGstin(action.businessId, reason);
}

/** Asks for the reason (3–500), runs the action, and reloads the page's record through `onDone`. */
export function StatusActionDialog({ action, onClose, onDone }: { action: StatusAction; onClose: () => void; onDone: () => void }) {
  const copy = COPY[action.kind];
  return (
    <ReasonDialog
      title={copy.title(action.name)}
      description={copy.description}
      minLength={REASON_MIN}
      maxLength={REASON_MAX}
      submitLabel={copy.submit}
      onClose={onClose}
      onSubmit={async (reason) => {
        try {
          await run(action, reason);
          toast.success(copy.done);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not save');
          // 409: the record changed elsewhere (already suspended, a review opened…): close and show the current state.
          if (!(err instanceof ApiError && err.status === 409)) return false;
        }
        onDone();
        return true;
      }}
    />
  );
}
