'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronsLeft, ChevronsRight, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { NAV_DASHBOARD, NAV_GROUPS, canSee, findActiveNav, type NavItem } from '@/lib/nav';
import { badgeText, useNavBadges, type NavBadgeKey } from '@/lib/nav-badges';
import { useSidebarState } from './sidebar-state';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

/** One half of the L | R lockup mark (the mockup's `.tok i.on`). */
const HALF = 'grid h-[18px] w-[18px] place-items-center bg-brand-600 text-[9.5px] font-extrabold not-italic leading-none text-white';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  moderator: 'Moderator',
  verification_officer: 'Verification officer',
  category_manager: 'Category manager',
  operations: 'Operations',
  support: 'Support',
};

export default function Sidebar() {
  const pathname = usePathname() ?? '/';
  const { user, logout } = useAuth();
  const { collapsed, toggleCollapsed, isGroupFolded, toggleGroup } = useSidebarState();
  const active = findActiveNav(pathname);

  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => canSee(i, user?.role)) }))
    .filter((g) => g.items.length > 0);
  const badgeKeys = groups.flatMap((g) => g.items.flatMap((i) => (i.badgeKey ? [i.badgeKey] : [] as NavBadgeKey[])));
  const badges = useNavBadges(badgeKeys);

  const row = (item: NavItem) => {
    const isActive = active?.item.href === item.href;
    const Icon = item.icon;
    const badge = item.badgeKey ? badgeText(item.badgeKey, badges[item.badgeKey]) : null;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={isActive ? 'page' : undefined}
          title={collapsed ? item.label : undefined}
          className={cn(
            'relative flex items-center gap-[9px] rounded-full py-2 text-[12.5px] transition-colors',
            collapsed ? 'justify-center px-0' : 'px-2.5',
            isActive
              ? 'bg-brand-50 font-extrabold text-brand-700'
              : 'font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            FOCUS,
          )}
        >
          <Icon size={16} aria-hidden className="shrink-0" />
          <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{item.label}</span>
          {badge && (collapsed ? (
            <span className="absolute right-2.5 top-1.5 h-2 w-2 rounded-full bg-brand-600"><span className="sr-only">, {badge} waiting</span></span>
          ) : (
            <span className="shrink-0 rounded-full bg-brand-600 px-[7px] py-px text-[10.5px] font-extrabold text-white tnum">
              {badge}<span className="sr-only"> waiting</span>
            </span>
          ))}
        </Link>
      </li>
    );
  };

  return (
    <aside
      data-nav-sidebar
      className={cn(
        'fixed left-0 top-0 z-30 flex h-screen flex-col border-r border-gray-200 bg-white text-gray-600 transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* The mockup's `.a-logo` lockup (R14): an L | R mark, the app's name and a yellow "Admin" badge. */}
      <div className={cn('flex h-16 shrink-0 items-center gap-2', collapsed ? 'justify-center' : 'px-[18px]')}>
        <span aria-hidden className="inline-flex shrink-0 gap-[2px]">
          <i className={cn(HALF, 'rounded-l-full rounded-r-[4px]')}>L</i>
          <i className={cn(HALF, 'rounded-l-[4px] rounded-r-full')}>R</i>
        </span>
        {!collapsed && (
          <>
            <span className="truncate text-base font-extrabold tracking-[-0.01em] text-gray-900">Machine Parts</span>
            <span className="ml-auto shrink-0 rounded-full bg-sun px-[7px] py-px text-[10.5px] font-extrabold text-sun-ink">Admin</span>
          </>
        )}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-3 [scrollbar-width:thin]">
        <ul className="space-y-0.5">{row(NAV_DASHBOARD)}</ul>

        {groups.map((g) => {
          // The group holding the current page never folds away.
          const holdsActive = active?.group?.id === g.id;
          const open = collapsed || holdsActive || !isGroupFolded(g.id);
          const listId = `nav-group-${g.id}`;
          return (
            <div key={g.id} className={collapsed ? 'mt-2 border-t border-gray-200 pt-2' : 'mt-4'}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => !holdsActive && toggleGroup(g.id)}
                  aria-expanded={open}
                  aria-controls={listId}
                  disabled={holdsActive}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2.5 py-1 text-xs font-semibold text-gray-400 transition-colors enabled:hover:text-gray-600',
                    FOCUS,
                  )}
                >
                  {g.label}
                  <ChevronDown size={14} aria-hidden className={cn('transition-transform', !open && '-rotate-90')} />
                </button>
              )}
              {open && (
                <ul id={listId} className={cn('space-y-0.5', !collapsed && 'mt-1')}>
                  {g.items.map(row)}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-gray-200 p-2">
        <div className={cn('flex items-center gap-2', collapsed ? 'justify-center' : 'pl-3')}>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-gray-900">{user?.name}</p>
              <p className="truncate text-xs font-semibold text-gray-400">{user ? ROLE_LABEL[user.role] : ''}</p>
            </div>
          )}
          <button
            type="button"
            onClick={logout}
            aria-label="Log out"
            title="Log out"
            className={cn('rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900', FOCUS)}
          >
            <LogOut size={18} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          className={cn(
            'mt-1 hidden w-full items-center rounded-full py-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 lg:flex',
            collapsed ? 'justify-center' : 'px-3',
            FOCUS,
          )}
        >
          {collapsed ? <ChevronsRight size={18} aria-hidden /> : <ChevronsLeft size={18} aria-hidden />}
        </button>
      </div>
    </aside>
  );
}
