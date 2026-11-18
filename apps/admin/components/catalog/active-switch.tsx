'use client';

import { cn } from '@/lib/utils';

/** The on/off switch the catalogue lists use for "active" (deactivate, never delete). */
export function ActiveSwitch({ checked, label, disabled, onToggle }: {
  checked: boolean;
  /** Accessible name, e.g. "Tajima active". */
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1 disabled:opacity-50',
        checked ? 'bg-brand-600' : 'bg-gray-200',
      )}
    >
      <span className={cn('inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-[19px]' : 'translate-x-[3px]')} />
    </button>
  );
}

/** A small pill used across the catalogue tables. */
export function Tag({ children, tone = 'grey', title }: {
  children: React.ReactNode;
  tone?: 'grey' | 'brand' | 'amber' | 'blue' | 'green';
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-6 items-center whitespace-nowrap rounded-full px-[9px] text-[12.5px] font-bold',
        tone === 'grey' && 'bg-gray-100 text-gray-600',
        tone === 'brand' && 'bg-brand-50 text-brand-700',
        tone === 'amber' && 'bg-amber-50 text-amber-600',
        tone === 'blue' && 'bg-brand-50 text-brand-700',
        tone === 'green' && 'bg-green-50 text-green-600',
      )}
    >
      {children}
    </span>
  );
}
