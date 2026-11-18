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
        <span className="ml-1.5 rounded-full bg-white/70 px-1.5 py-px text-[11px] font-bold text-gray-600 tnum">{count}</span>
      )}
    </>
  );
}

// Segmented control (spec §10.2, R13; the mockup's `.segmented` v2): a grey track, the selected tab a white chip.
// `max-w-full` + `overflow-x-auto` keep a long strip scrolling inside the page instead of widening it.
const STRIP = 'mb-5 flex w-fit max-w-full gap-0.5 overflow-x-auto overflow-y-hidden rounded-xl bg-gray-100 p-[3px]';

const tabClass = (active: boolean) =>
  cn(
    'inline-flex items-center whitespace-nowrap rounded-[9px] px-3 py-1.5 text-[13px] font-bold transition-colors',
    active ? 'bg-white text-gray-900 shadow-[0_1px_3px_rgb(28_20_70/0.14)]' : 'text-gray-600 hover:text-gray-900',
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
