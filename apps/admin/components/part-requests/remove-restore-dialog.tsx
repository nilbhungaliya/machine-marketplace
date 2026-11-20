'use client';

import { useState } from 'react';
import { Ban, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminPartRequestDetail } from '@mpm/shared-types';
import { Button } from '@/components/ui/button';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { useAuth } from '@/lib/auth-context';
import {
  PART_REQUEST_STATUS_LABELS, explainPartRequestError, removePartRequest, restorePartRequest,
} from '@/lib/part-requests-api';

export type RemoveRestoreMode = 'remove' | 'restore';

/** What the dialog needs of the request. */
export type RemoveRestoreTarget = Pick<AdminPartRequestDetail, 'id' | 'name' | 'status' | 'returnStatus' | 'buyer' | 'reports'>;

/** The roles that may remove or restore (the API's `requireAdminRole('moderator', 'support')`; super_admin passes). */
export const PART_REQUEST_ACTION_ROLES = ['moderator', 'support'] as const;

/**
 * Remove a requirement, or restore a removed one (F8 spec §9.1, §14), with a reason (3–500, audit-logged). Remove takes
 * it off every seller's list, drops pending replies, closes its open reports as actioned with the reason and tells the
 * buyer (without the reason). Restore puts it back in the status it had, with no notification and no re-targeting.
 * Mount it only while open.
 */
export function RemoveRestoreDialog({ mode, request, onClose, onDone }: {
  mode: RemoveRestoreMode;
  request: RemoveRestoreTarget;
  onClose: () => void;
  /** After a change, or a refusal that means the request changed meanwhile: reload. */
  onDone: (next: AdminPartRequestDetail | null) => void;
}) {
  const openReports = request.reports.filter((r) => r.status === 'open' || r.status === 'reviewing').length;
  const back = request.returnStatus ? PART_REQUEST_STATUS_LABELS[request.returnStatus].toLowerCase() : 'its earlier status';

  const description = mode === 'remove'
    ? `"${request.name}" leaves every seller's list at once and takes no more replies; replies waiting for a listing to go live are dropped. ${request.buyer.name} is told the team removed it, without your reason.${openReports ? ` ${openReports === 1 ? 'Its open report closes' : `Its ${openReports} open reports close`} as actioned with your reason.` : ''}`
    : `"${request.name}" goes back to ${back} (an active one past its expiry comes back expired). The buyer isn't told and no seller is notified again.`;

  return (
    <ReasonDialog
      title={mode === 'remove' ? 'Remove this requirement' : 'Restore this requirement'}
      description={description}
      hint="Stays with staff and in the audit log. 3 to 500 characters."
      submitLabel={mode === 'remove' ? 'Remove' : 'Restore'}
      submitVariant={mode === 'remove' ? 'danger' : 'primary'}
      onClose={onClose}
      onSubmit={async (reason) => {
        try {
          const next = mode === 'remove'
            ? await removePartRequest(request.id, { reason })
            : await restorePartRequest(request.id, { reason });
          toast.success(mode === 'remove' ? 'Requirement removed' : 'Requirement restored');
          onDone(next);
          return true;
        } catch (err) {
          const { message, stale } = explainPartRequestError(err);
          toast.error(message);
          if (!stale) return false;
          onDone(null);
          return true;
        }
      }}
    />
  );
}

/** Remove (any status but removed) or Restore (removed), for the roles that may; nothing for the others. */
export function RemoveRestoreButton({ request, onDone }: {
  request: RemoveRestoreTarget;
  onDone: (next: AdminPartRequestDetail | null) => void;
}) {
  const { hasRole } = useAuth();
  const [open, setOpen] = useState(false);
  if (!hasRole(...PART_REQUEST_ACTION_ROLES)) return null;
  const mode: RemoveRestoreMode = request.status === 'removed' ? 'restore' : 'remove';

  return (
    <>
      {mode === 'remove' ? (
        <Button variant="danger" onClick={() => setOpen(true)}><Ban size={15} aria-hidden /> Remove</Button>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}><RotateCcw size={15} aria-hidden /> Restore</Button>
      )}
      {open && <RemoveRestoreDialog mode={mode} request={request} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}
