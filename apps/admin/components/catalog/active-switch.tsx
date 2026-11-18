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
        'relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50',
        checked ? 'bg-brand-600' : 'bg-gray-300',
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
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
        'inline-flex h-6 items-center whitespace-nowrap rounded-full px-[9px] text-[12.5px] font-semibold',
        tone === 'grey' && 'bg-gray-100 text-gray-600',
        tone === 'brand' && 'bg-brand-50 text-brand-800',
        tone === 'amber' && 'bg-amber-50 text-amber-800',
        tone === 'blue' && 'bg-blue-50 text-blue-700',
        tone === 'green' && 'bg-green-50 text-green-700',
      )}
    >
      {children}
    </span>
  );
}
