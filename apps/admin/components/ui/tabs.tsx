'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const strip = (p: string) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

// `count` may be a string, e.g. '—' when the number could not be loaded.
function TabLabel({ label, count, badge }: { label: string; count?: number | string; badge?: ReactNode }) {
  return (
    <>
      {label}
      {badge}
      {count !== undefined && (
        <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-px text-[11px] font-semibold text-gray-500 tnum">{count}</span>
      )}
    </>
  );
}

// The grey line is an inset shadow, not a border: a tab pulled over a border
// with -mb-px overflows the strip by 1px, which shows a scroll bar.
const STRIP = 'mb-5 flex gap-6 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_theme(colors.gray.200)]';

const tabClass = (active: boolean) =>
  cn(
    'whitespace-nowrap border-b-2 px-0.5 pb-2.5 pt-1 text-sm transition-colors',
    active ? 'border-brand-500 font-semibold text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800',
  );

export function LinkTabs({ tabs, className }: {
  tabs: Array<{ href: string; label: string; count?: number; match?: (path: string) => boolean }>;
  className?: string;
}) {
  const path = strip(usePathname() ?? '');
  return (
    <nav className={cn(STRIP, className)}>
      {tabs.map((t) => {
        const active = t.match ? t.match(path) : path === strip(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined} className={tabClass(active)}>
            <TabLabel label={t.label} count={t.count} />
          </Link>
        );
      })}
    </nav>
  );
}

export function Tabs<T extends string>({ items, value, onChange, className }: {
  /** `badge` renders after the label, e.g. an unsaved-changes dot. */
  items: Array<{ value: T; label: string; count?: number | string; badge?: ReactNode }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  refs.current.length = items.length;
  const selected = items.findIndex((it) => it.value === value);
  // Roving tabindex: one Tab stop for the strip; if nothing matches, the first tab.
  const stop = selected === -1 ? 0 : selected;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = items.length;
    if (n === 0) return;
    const at = refs.current.findIndex((el) => el === document.activeElement);
    const from = at === -1 ? stop : at;
    let next: number;
    if (e.key === 'ArrowRight') next = (from + 1) % n;
    else if (e.key === 'ArrowLeft') next = (from - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else return;
    e.preventDefault();
    onChange(items[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" onKeyDown={onKeyDown} className={cn(STRIP, className)}>
      {items.map((it, i) => (
        <button
          key={it.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="tab"
          aria-selected={it.value === value}
          tabIndex={i === stop ? 0 : -1}
          onClick={() => onChange(it.value)}
          className={tabClass(it.value === value)}
        >
          <TabLabel label={it.label} count={it.count} badge={it.badge} />
        </button>
      ))}
    </div>
  );
}
