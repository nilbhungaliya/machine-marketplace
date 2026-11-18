'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronsLeft, ChevronsRight, Layers, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { NAV_DASHBOARD, NAV_GROUPS, canSee, findActiveNav, type NavItem } from '@/lib/nav';
import { badgeText, useNavBadges, type NavBadgeKey } from '@/lib/nav-badges';
import { useSidebarState } from './sidebar-state';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

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
            'relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
            collapsed ? 'justify-center px-0' : 'px-3',
            isActive
              ? 'bg-side-hover text-white before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-brand-400'
              : 'hover:bg-side-hover hover:text-white',
            FOCUS,
          )}
        >
          <Icon size={18} aria-hidden className="shrink-0" />
          <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{item.label}</span>
          {badge && (collapsed ? (
            <span className="absolute right-2.5 top-1.5 h-2 w-2 rounded-full bg-amber-400"><span className="sr-only">, {badge} waiting</span></span>
          ) : (
            <span className="shrink-0 rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-gray-900 tnum">
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
        'fixed left-0 top-0 z-30 flex h-screen flex-col bg-side text-side-text transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className={cn('flex h-16 shrink-0 items-center gap-2.5 border-b border-side-line', collapsed ? 'justify-center' : 'px-5')}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Layers size={16} aria-hidden />
        </span>
        {!collapsed && <span className="truncate text-base font-bold tracking-tight text-white">MPM Admin</span>}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 [scrollbar-width:thin]">
        <ul className="space-y-0.5">{row(NAV_DASHBOARD)}</ul>

        {groups.map((g) => {
          // The group holding the current page never folds away.
          const holdsActive = active?.group?.id === g.id;
          const open = collapsed || holdsActive || !isGroupFolded(g.id);
          const listId = `nav-group-${g.id}`;
          return (
            <div key={g.id} className={collapsed ? 'mt-2 border-t border-side-line pt-2' : 'mt-4'}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => !holdsActive && toggleGroup(g.id)}
                  aria-expanded={open}
                  aria-controls={listId}
                  disabled={holdsActive}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-1 text-xs font-semibold text-side-dim transition-colors enabled:hover:text-side-text',
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

      <div className="shrink-0 border-t border-side-line p-2">
        <div className={cn('flex items-center gap-2', collapsed ? 'justify-center' : 'pl-3')}>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user?.name}</p>
              <p className="truncate text-xs text-side-dim">{user ? ROLE_LABEL[user.role] : ''}</p>
            </div>
          )}
          <button
            type="button"
            onClick={logout}
            aria-label="Log out"
            title="Log out"
            className={cn('rounded-lg p-2 text-side-dim transition-colors hover:bg-side-hover hover:text-white', FOCUS)}
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
            'mt-1 hidden w-full items-center rounded-lg py-2 text-side-dim transition-colors hover:bg-side-hover hover:text-white lg:flex',
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
