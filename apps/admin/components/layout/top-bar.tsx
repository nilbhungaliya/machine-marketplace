'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { findActiveNav } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { usePageTrail } from '@/components/layout/page-trail';

const PART = 'truncate max-w-[16rem]';

/** Group / page / the page's own trail. Nothing for a page outside the menu map. */
function Breadcrumb() {
  const active = findActiveNav(usePathname() ?? '/');
  const trail = usePageTrail();
  if (!active) return null;
  const { group, item } = active;
  const sep = <span aria-hidden className="shrink-0 text-gray-300">/</span>;
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-sm">
      {group && (
        <>
          <span className={cn(PART, 'shrink-0 text-gray-400')}>{group.label}</span>
          {sep}
        </>
      )}
      {trail.length > 0 ? (
        <Link href={item.href} className={cn(PART, 'shrink-0 rounded text-gray-500 hover:text-gray-900')}>
          {item.label}
        </Link>
      ) : (
        <span aria-current="page" className={cn(PART, 'font-bold text-gray-900')}>{item.label}</span>
      )}
      {trail.map((part, i) => {
        const last = i === trail.length - 1;
        return (
          <Fragment key={i}>
            {sep}
            <span aria-current={last ? 'page' : undefined} className={cn(PART, last ? 'min-w-0 font-bold text-gray-900' : 'shrink-0 text-gray-500')}>
              {part}
            </span>
          </Fragment>
        );
      })}
    </nav>
  );
}

export default function TopBar() {
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-4 bg-gray-50 px-4 lg:px-6">
      <Breadcrumb />
      <div className="ml-auto flex shrink-0 items-center gap-4">
        {/* Placeholder until the notifications module lands. */}
        <button
          type="button"
          aria-label="Notifications"
          className="grid h-9 w-9 place-items-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        >
          <Bell size={18} aria-hidden />
        </button>
      </div>
    </header>
  );
}
