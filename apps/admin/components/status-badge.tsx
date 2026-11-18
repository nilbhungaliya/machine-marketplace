'use client';

import { cn } from '@/lib/utils';
import { TONE_CLASSES, statusLabel, statusTone, type StatusTone } from '@/lib/status';

interface StatusBadgeProps {
  status: string;
  /** Overrides the derived wording. */
  label?: string;
  /** Overrides the colour from the shared map, for a word that means something else here. */
  tone?: StatusTone;
  className?: string;
}

export default function StatusBadge({ status, label, tone, className }: StatusBadgeProps) {
  if (!status) return null;
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11px] font-extrabold', TONE_CLASSES[tone ?? statusTone(status)], className)}>
      {label ?? statusLabel(status)}
    </span>
  );
}
