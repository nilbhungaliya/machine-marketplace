'use client';

import { ReasonDialog } from '@/components/ui/reason-dialog';

export type TextDecision = 'reject' | 'ask_for_more';

const COPY: Record<TextDecision, { title: string; description: string; label: string; submit: string; danger: boolean }> = {
  reject: {
    title: 'Reject this review',
    description: 'The business sees this reason and can start again with new documents.',
    label: 'Reason',
    submit: 'Reject',
    danger: true,
  },
  ask_for_more: {
    title: 'Ask for more',
    description: 'The business sees this message and adds files; the review then comes back to Waiting.',
    label: 'Message to the business',
    submit: 'Send',
    danger: false,
  },
};

/** Reject (reason) or Ask for more (message): 3–500 characters, the business reads it (F1 + A2 spec §5.3, §8.1). */
export function DecisionDialog({ kind, businessName, onClose, onSubmit }: {
  kind: TextDecision;
  businessName: string;
  onClose: () => void;
  /** Resolves true when the dialog should close. */
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const copy = COPY[kind];
  return (
    <ReasonDialog
      title={copy.title}
      description={<>{businessName}. {copy.description}</>}
      label={copy.label}
      submitLabel={copy.submit}
      submitVariant={copy.danger ? 'danger' : 'primary'}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}
