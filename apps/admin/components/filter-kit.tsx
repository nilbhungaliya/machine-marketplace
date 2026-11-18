'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** The pieces of a table's filter bar and popup — shared by every list page. */

export function FiltersButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full border-[1.5px] px-3.5 py-2 text-sm font-bold ${count
        ? 'border-brand-100 bg-brand-100 text-brand-700'
        : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50'}`}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
        <path d="M3 5h18M6 12h12M10 19h4" />
      </svg>
      Filters
      {count > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-xs font-extrabold text-white">{count}</span>}
    </button>
  );
}

export function SearchBox({ value, onChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; placeholder: string;
  /** Accessible name; the placeholder otherwise. */
  label?: string;
}) {
  return (
    <div className="relative min-w-[16rem] flex-1">
      <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="w-full rounded-xl border-0 bg-gray-100 py-2 pl-9 pr-3 text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-brand-600"
      />
    </div>
  );
}

export interface ActiveChip { key: string; label: string; text: string; remove: () => void }

export function ActiveChipsRow({ chips, onClearAll }: { chips: ActiveChip[]; onClearAll: () => void }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-3 py-2.5">
      <span className="text-xs font-semibold text-gray-500">Showing</span>
      {chips.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 py-1 pl-3 pr-1.5 text-xs font-semibold text-gray-700">
          {c.label && <span className="text-gray-500">{c.label}</span>}
          <b className="font-bold">{c.text}</b>
          <button
            type="button"
            onClick={c.remove}
            className="rounded-full px-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
            aria-label={`Remove ${c.label || c.text}`}
          >
            ✕
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-1 text-xs font-semibold text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}

export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-xs font-bold text-gray-600">{title}</h4>
      {children}
    </section>
  );
}

export function ChipGroup({ items, selected, onToggle, small }: {
  items: [string, string][]; selected: string[]; onToggle: (v: string) => void; small?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(([v, l]) => {
        const on = selected.includes(v);
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(v)}
            className={`rounded-full px-2.5 py-1 font-bold ${small ? 'text-xs' : 'text-sm'} ${on
              ? 'bg-brand-100 text-brand-700'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {on && '✓ '}{l}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented({ items, value, onChange }: {
  items: [string, ReactNode][]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-xl bg-gray-100 p-[3px] text-[13px] font-bold text-gray-600">
      {items.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`flex-1 whitespace-nowrap rounded-[9px] px-2 py-1.5 ${value === v ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-900'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * How many rows a draft would show, asked after a pause so ticking five chips is
 * one request. null while it is being asked, or when asking failed.
 */
export function useDraftCount<F>(draft: F, countMatches: (f: F) => Promise<number>): number | null {
  const [matches, setMatches] = useState<number | null>(null);
  useEffect(() => {
    let stale = false;
    setMatches(null);
    const t = setTimeout(() => {
      // Quiet on purpose: a live count on the Apply button; on failure it just says "Apply".
      countMatches(draft).then((n) => { if (!stale) setMatches(n); }).catch(() => {});
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [draft, countMatches]);
  return matches;
}

/** The popup around a filter form: nothing reaches the table until Apply. */
export function FilterDialog({ title, wide, selected, matches, itemLabel, onClear, onClose, onApply, children }: {
  title: string;
  /** Two columns on a desktop; otherwise one narrower column. */
  wide?: boolean;
  selected: number;
  matches: number | null;
  /** Singular and plural, e.g. ["booking", "bookings"]. */
  itemLabel: [string, string];
  onClear: () => void;
  onClose: () => void;
  onApply: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size={wide ? 'xl' : 'md'}
      footer={
        <div className="flex w-full items-center gap-3">
          <Button variant="ghost" onClick={onClear}>Clear all</Button>
          {selected > 0 && <span className="text-xs text-gray-400">· {selected} selected</span>}
          <Button variant="secondary" onClick={onClose} className="ml-auto">Cancel</Button>
          <Button data-dialog-primary onClick={onApply} className="min-w-[10rem]">
            {matches === null ? 'Apply' : `Show ${matches} ${matches === 1 ? itemLabel[0] : itemLabel[1]}`}
          </Button>
        </div>
      }
    >
      <div className={`grid grid-cols-1 gap-x-8 gap-y-5 ${wide ? 'md:grid-cols-2' : ''}`}>
        {children}
      </div>
    </Dialog>
  );
}
