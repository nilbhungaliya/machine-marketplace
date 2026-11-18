'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { NodeChoice } from '@/lib/category-tree';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/field-classes';

/**
 * A native select with a filter box above it, for long node lists (≈250 machine types).
 * The chosen option stays listed even when the filter hides it, so the select never
 * silently changes value.
 */
export function SearchableSelect({ id, label, choices, value, onChange, placeholder = 'Choose…', disabled, invalid, describedBy }: {
  id: string;
  label: string;
  choices: NodeChoice[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return choices;
    return choices.filter((c) => c.id === value || c.label.toLowerCase().includes(q));
  }, [choices, filter, value]);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13.5px] font-semibold text-gray-900">{label}</label>
      <div className="relative">
        <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder="Type to narrow the list"
          value={filter}
          disabled={disabled}
          onChange={(e) => setFilter(e.target.value)}
          // Enter filters; it must not submit the dialog around it.
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
          className={cn(inputCls, 'h-8 pl-8')}
        />
      </div>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls, invalid && 'ring-2 ring-red-600')}
      >
        <option value="">{shown.length ? placeholder : 'No matches'}</option>
        {shown.map((c) => (
          <option key={c.id} value={c.id}>{c.label}{c.isActive ? '' : ' (off)'}</option>
        ))}
      </select>
    </div>
  );
}
