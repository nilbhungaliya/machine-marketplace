'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { adminActions, type AdminListingAction, type AdminListingDetail } from '@mpm/shared-types';
import { useConfirm } from '@/components/confirm-provider';
import { Button } from '@/components/ui/button';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  LISTING_CHANGED_MESSAGE, REFUSAL_CODES, approveListing, askForChanges, editListing, explainListingError, hideListing,
  rejectListing, removeListing, unhideListing,
} from '@/lib/listings-api';
import { refreshNavBadges } from '@/lib/nav-badges';
import { LISTING_STATUS_LABELS } from '@/lib/status';
import { ListingEditDialog } from './listing-edit-dialog';

type TextAction = 'ask_for_changes' | 'reject' | 'hide' | 'remove';

const TEXT_COPY: Record<TextAction, {
  title: string; description: string; label: string; submit: string; danger: boolean; success: string;
}> = {
  ask_for_changes: {
    title: 'Ask for changes',
    description: 'The seller reads this message, fixes the listing and sends it again.',
    label: 'Message to the seller',
    submit: 'Send',
    danger: false,
    success: 'Sent back to the seller',
  },
  reject: {
    title: 'Reject this listing',
    description: 'The seller reads the reason and may still fix and resubmit it. Remove is the final action.',
    label: 'Reason',
    submit: 'Reject',
    danger: true,
    success: 'Listing rejected',
  },
  hide: {
    title: 'Hide this listing',
    description: 'Buyers stop seeing it at once; open reports are closed as actioned. You can unhide it later.',
    label: 'Reason',
    submit: 'Hide',
    danger: true,
    success: 'Listing hidden',
  },
  remove: {
    title: 'Remove this listing',
    description: 'This is final: the listing never comes back. The seller sees it for 30 days with your reason.',
    label: 'Reason',
    submit: 'Remove',
    danger: true,
    success: 'Listing removed',
  },
};

const BUTTONS: Record<AdminListingAction, { label: string; variant: 'primary' | 'secondary' | 'danger' }> = {
  approve: { label: 'Approve', variant: 'primary' },
  ask_for_changes: { label: 'Ask for changes', variant: 'secondary' },
  reject: { label: 'Reject', variant: 'danger' },
  hide: { label: 'Hide', variant: 'secondary' },
  unhide: { label: 'Unhide', variant: 'secondary' },
  remove: { label: 'Remove', variant: 'danger' },
};

/** Approve and unhide read best last; the rest in the shared order. */
const ORDER: AdminListingAction[] = ['remove', 'reject', 'hide', 'ask_for_changes', 'unhide', 'approve'];

/**
 * The review screen's action bar (F2 spec §11.3): the moderator status actions the status allows (`adminActions`),
 * plus Edit category / side / fit. Approve, ask for changes, reject and edit send the loaded `version`; hide, unhide
 * and remove don't (R53). Moderators only: support reads the listing with no buttons.
 */
export function ListingActions({ detail, stale, onReload, onResult, onConflict }: {
  detail: AdminListingDetail;
  /** The seller changed the listing since it was loaded (`409 LISTING_CHANGED`): every action waits for Reload. */
  stale: boolean;
  onReload: () => void;
  /** The refreshed listing an action answered with. */
  onResult: (next: AdminListingDetail) => void;
  /** A 409 the page handles: `LISTING_CHANGED` (stale warning) or another (reload). */
  onConflict: (code: string) => void;
}) {
  const { hasRole } = useAuth();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<TextAction | 'edit' | null>(null);
  const [busy, setBusy] = useState<AdminListingAction | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const l = detail.listing;

  if (!hasRole('moderator')) return null;

  const allowed = adminActions(l.status, l.kind);
  const actions = ORDER.filter((a) => allowed.includes(a));
  const canEdit = l.status !== 'draft' && l.status !== 'removed';
  if (actions.length === 0 && !canEdit) return null;

  /**
   * Runs an action; resolves true when its dialog should close. A stale version (`409 LISTING_CHANGED`) keeps the
   * dialog open with what was typed: the moderator reloads inside it and sends again with the fresh version.
   */
  const run = async (work: () => Promise<AdminListingDetail>, success: string): Promise<boolean> => {
    setRefusal(null);
    try {
      const next = await work();
      toast.success(success);
      refreshNavBadges();
      onResult(next);
      return true;
    } catch (err) {
      const message = explainListingError(err, 'Could not save the decision');
      if (err instanceof ApiError && err.status === 409) {
        toast.error(message);
        onConflict(err.code ?? 'CONFLICT');
        return err.code !== 'LISTING_CHANGED';
      }
      if (err instanceof ApiError && err.code && REFUSAL_CODES.includes(err.code)) {
        setRefusal(message);
        toast.error(message);
        return true;
      }
      // A validation or network error: keep the dialog and what was typed.
      toast.error(message);
      return false;
    }
  };

  const click = async (action: AdminListingAction) => {
    if (action === 'approve') {
      setBusy('approve');
      await run(() => approveListing(l.id, l.version), 'Listing approved');
      setBusy(null);
      return;
    }
    if (action === 'unhide') {
      const ok = await confirm({
        title: 'Unhide this listing?',
        message: `It goes back to ${l.returnStatus ? LISTING_STATUS_LABELS[l.returnStatus] : 'where it was'} and counts as freshly updated.`,
        confirmLabel: 'Unhide',
      });
      if (!ok) return;
      setBusy('unhide');
      await run(() => unhideListing(l.id), 'Listing unhidden');
      setBusy(null);
      return;
    }
    setDialog(action);
  };

  const submitText = (action: TextAction, text: string) => {
    const success = TEXT_COPY[action].success;
    switch (action) {
      case 'ask_for_changes': return run(() => askForChanges(l.id, l.version, text), success);
      case 'reject': return run(() => rejectListing(l.id, l.version, text), success);
      case 'hide': return run(() => hideListing(l.id, text), success);
      case 'remove': return run(() => removeListing(l.id, text), success);
    }
  };

  // Inside an open dialog, so the typed text survives the reload.
  const staleNotice = stale ? (
    <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
      <span className="flex-1">{LISTING_CHANGED_MESSAGE}</span>
      <Button variant="secondary" size="sm" onClick={onReload}>Reload</Button>
    </div>
  ) : null;

  return (
    <div>
      <div className="flex flex-wrap justify-end gap-2">
        {canEdit && (
          <Button variant="ghost" disabled={stale} onClick={() => setDialog('edit')}>Edit category, side or fit</Button>
        )}
        {actions.map((a) => (
          <Button key={a} variant={BUTTONS[a].variant} loading={busy === a} disabled={busy !== null || stale} onClick={() => void click(a)}>
            {BUTTONS[a].label}
          </Button>
        ))}
      </div>
      {refusal && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{refusal}</p>
      )}

      {dialog && dialog !== 'edit' && (
        <ReasonDialog
          title={TEXT_COPY[dialog].title}
          description={<>{l.title}. {TEXT_COPY[dialog].description}</>}
          label={TEXT_COPY[dialog].label}
          submitLabel={TEXT_COPY[dialog].submit}
          submitVariant={TEXT_COPY[dialog].danger ? 'danger' : 'primary'}
          submitBlocked={stale}
          onClose={() => setDialog(null)}
          onSubmit={(text) => submitText(dialog, text)}
        >
          {staleNotice}
        </ReasonDialog>
      )}
      {dialog === 'edit' && (
        <ListingEditDialog
          detail={detail}
          notice={staleNotice}
          blocked={stale}
          onClose={() => setDialog(null)}
          onSubmit={(patch) => run(() => editListing(l.id, { version: l.version, ...patch }), 'Listing corrected')}
        />
      )}
    </div>
  );
}
