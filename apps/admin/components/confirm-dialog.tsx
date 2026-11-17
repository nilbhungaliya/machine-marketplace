'use client';

import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export type ConfirmVariant = 'danger' | 'success' | 'primary';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  /** 'cancel': Enter and first focus take the safe choice, e.g. "Discard this form?". */
  enter?: 'confirm' | 'cancel';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'primary', enter = 'confirm', onConfirm, onCancel,
}: ConfirmDialogProps) {
  const safe = enter === 'cancel';
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      size="sm"
      onEnter={safe ? onCancel : undefined}
      // A danger confirm starts on the panel: a fresh Enter confirms, a held one (repeat) is blocked.
      focusPanel={!safe && variant === 'danger'}
      footer={
        <>
          <Button variant="secondary" data-autofocus={safe || undefined} onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} data-dialog-primary={!safe || undefined} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    />
  );
}
