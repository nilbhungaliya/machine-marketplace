'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-provider';

/**
 * A popup holding a form: Enter submits (unless focus is in a textarea, select
 * or button), and closing it (X, Escape, backdrop, Cancel) asks before
 * throwing away typed input. Nothing closes mid-submit,
 * and a second submit is ignored until the first `onSubmit` has settled.
 */
export function FormDialog({
  open, onClose, title, description, size = 'md', dirty, submitting = false,
  submitLabel, submitDisabled = false, onSubmit, extraFooter, discardMessage = 'What you typed will be lost.', children,
}: {
  open: boolean;
  /** Called after the discard check passes. */
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Caller-computed: any field differs from its starting value. */
  dirty: boolean;
  submitting?: boolean;
  submitLabel: string;
  submitDisabled?: boolean;
  onSubmit: () => void | Promise<void>;
  /** Left side of the footer, e.g. a preview button. */
  extraFooter?: ReactNode;
  /** Body of the "Discard this form?" confirm. */
  discardMessage?: string;
  children: ReactNode;
}) {
  const formId = useId();
  const form = useRef<HTMLFormElement | null>(null);
  const confirm = useConfirm();
  // The ref blocks a second submit in the same tick, before any re-render;
  // the state shows the spinner while the parent has not set `submitting` yet.
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const busy = submitting || pending;

  const submit = async () => {
    if (submitDisabled || submitting || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await onSubmit();
    } catch (err) {
      // Handlers report their own errors; this only keeps the guard from sticking.
      console.error(err);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const requestClose = async () => {
    if (busy || inFlight.current) return;
    if (dirty) {
      const ok = await confirm({
        title: 'Discard this form?',
        message: discardMessage,
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        variant: 'danger',
        enter: 'cancel',
      });
      if (!ok) return;
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={() => { void requestClose(); }}
      title={title}
      description={description}
      size={size}
      // Through the form, so submit()'s guards apply wherever focus is (a checkbox too).
      onEnter={() => form.current?.requestSubmit()}
      footer={
        <div className="flex w-full items-center gap-2">
          <div className="mr-auto flex items-center gap-2">{extraFooter}</div>
          <Button variant="secondary" onClick={() => { void requestClose(); }} disabled={busy}>Cancel</Button>
          {/* Only `submitting` disables it: a button disabled under a handler's own
              confirm could not take focus back when that confirm closes. */}
          <Button type="submit" form={formId} data-dialog-primary loading={submitting} disabled={submitDisabled} aria-busy={busy}>
            {pending && !submitting ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
            {submitLabel}
          </Button>
        </div>
      }
    >
      <form
        ref={form}
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {children}
      </form>
    </Dialog>
  );
}
