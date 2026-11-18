'use client';

import { useState, type ReactNode } from 'react';
import { ADMIN_REASON_MAX, ADMIN_REASON_MIN } from '@mpm/shared-types';
import { FormDialog } from '@/components/ui/form-dialog';

/**
 * A popup asking for one piece of text: a reason, or a message the business reads. The submit button stays disabled
 * until the trimmed text has `minLength` characters. `onSubmit` reports its own errors and resolves true when the
 * dialog should close. Mount it only while open, so each opening starts empty. (As textile's ReasonDialog.)
 */
export function ReasonDialog({
  title, description, label = 'Reason', hint, minLength = ADMIN_REASON_MIN, maxLength = ADMIN_REASON_MAX, submitLabel, submitVariant,
  onClose, onSubmit, children,
}: {
  title: string;
  description?: ReactNode;
  label?: string;
  hint?: string;
  minLength?: number;
  maxLength?: number;
  submitLabel: string;
  /** `danger` when the action is destructive. */
  submitVariant?: 'primary' | 'danger';
  onClose: () => void;
  onSubmit: (text: string) => Promise<boolean>;
  /** Above the field, e.g. what happens next. */
  children?: ReactNode;
}) {
  const [text, setText] = useState('');
  const length = text.trim().length;
  const tooLong = length > maxLength;

  return (
    <FormDialog
      open
      onClose={onClose}
      title={title}
      description={description}
      dirty={text !== ''}
      submitLabel={submitLabel}
      submitVariant={submitVariant}
      submitDisabled={length < minLength || tooLong}
      onSubmit={async () => {
        if (await onSubmit(text.trim())) onClose();
      }}
    >
      <div className="space-y-3">
        {children}
        <div>
          <label htmlFor="reason-text" className="mb-1.5 block text-[13.5px] font-semibold text-gray-900">{label}</label>
          <textarea
            id="reason-text"
            rows={4}
            className="w-full rounded-lg border-gray-300 text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className={`mt-1 flex justify-between gap-3 text-[12.5px] ${tooLong ? 'text-red-700' : 'text-gray-500'}`}>
            <span>{hint ?? `${minLength} to ${maxLength} characters.`}</span>
            <span className="tnum">{length} / {maxLength}</span>
          </p>
        </div>
      </div>
    </FormDialog>
  );
}
