import type { LucideIcon } from 'lucide-react';
import type { AdminRole } from '@mpm/shared-types';
import {
  LayoutDashboard, ShieldCheck, ClipboardCheck, Building2, Package, Handshake, MessagesSquare, FolderTree,
  ListChecks, Megaphone, Flag, Bell, UserCog, ScrollText, BarChart3, BellRing, MessageSquareQuote, CalendarClock,
  Factory, SlidersHorizontal, MapPin, Replace, TrendingUp, Scale,
} from 'lucide-react';
import type { NavBadgeKey } from './nav-badges';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra URL prefixes that belong to this item. */
  also?: string[];
  /** Roles that see it besides super_admin. Absent = every admin. */
  roles?: AdminRole[];
  /** A count shown beside the label (`lib/nav-badges.ts`), fetched only for admins who see the item. */
  badgeKey?: NavBadgeKey;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_DASHBOARD: NavItem = { href: '/', label: 'Dashboard', icon: LayoutDashboard };

// Mirrors the admin panel modules in the product scope (docs/product-scope.txt, "Admin Panel", A1–A6).
export const NAV_GROUPS: NavGroup[] = [
  { id: 'queues', label: 'Queues', items: [
    { href: '/moderation', label: 'Listing moderation', icon: ClipboardCheck, roles: ['moderator'], badgeKey: 'moderationWaiting' },
    { href: '/verification', label: 'Business verification', icon: ShieldCheck, roles: ['verification_officer'], badgeKey: 'verificationWaiting' },
    // F6 + F7 §16.1: the API's `requireAdminRole('support')` (super_admin passes); the badge counts open disputes.
    { href: '/disputes', label: 'Disputes', icon: Scale, roles: ['support'], badgeKey: 'disputesOpen' },
    { href: '/reports', label: 'Reports & flags', icon: Flag, roles: ['moderator', 'support'] },
  ] },
  { id: 'marketplace', label: 'Marketplace', items: [
    { href: '/businesses', label: 'Users & businesses', icon: Building2, roles: ['support', 'verification_officer', 'moderator'] },
    { href: '/listings', label: 'Parts & machinery', icon: Package, roles: ['moderator', 'support'] },
    { href: '/part-requests', label: 'Part requests', icon: BellRing, roles: ['moderator', 'support'] },
    { href: '/enquiries', label: 'Enquiries & offers', icon: MessageSquareQuote, roles: ['support', 'operations'] },
    { href: '/deals', label: 'Deals', icon: Handshake, roles: ['support', 'operations'] },
    { href: '/rentals', label: 'Rental bookings', icon: CalendarClock, roles: ['operations'] },
    { href: '/chats', label: 'Conversations', icon: MessagesSquare, roles: ['moderator', 'support'] },
  ] },
  { id: 'configuration', label: 'Machine configuration', items: [
    { href: '/categories', label: 'Categories & machine types', icon: FolderTree, roles: ['category_manager'] },
    { href: '/brands-models', label: 'Brands, models & fit', icon: Factory, roles: ['category_manager'] },
    { href: '/listing-fields', label: 'Specifications & fields', icon: SlidersHorizontal, roles: ['category_manager'] },
    { href: '/master-data', label: 'Units, conditions & sides', icon: ListChecks, roles: ['category_manager'] },
    { href: '/industrial-areas', label: 'Industrial areas', icon: MapPin, roles: ['category_manager'] },
    // F4 + F5 §9: the API's `requireAdminRole('category_manager')` (super_admin passes).
    { href: '/search-synonyms', label: 'Search synonyms', icon: Replace, roles: ['category_manager'] },
    { href: '/search-insights', label: 'Search insights', icon: TrendingUp, roles: ['category_manager'] },
  ] },
  { id: 'growth', label: 'Insights & growth', items: [
    { href: '/analytics', label: 'Activity & KPIs', icon: BarChart3, roles: ['operations'] },
    { href: '/promotions', label: 'Featured & promotions', icon: Megaphone, roles: ['operations'] },
    { href: '/notifications', label: 'Notifications', icon: Bell, roles: ['operations'] },
  ] },
  { id: 'system', label: 'System', items: [
    { href: '/settings', label: 'Settings & roles', icon: UserCog, roles: [] },
    { href: '/audit-log', label: 'Audit log', icon: ScrollText, roles: [] },
  ] },
];

const ALL_ITEMS: { group: NavGroup | null; item: NavItem }[] = [
  { group: null, item: NAV_DASHBOARD },
  ...NAV_GROUPS.flatMap((group) => group.items.map((item) => ({ group, item }))),
];

function matches(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname === '/';
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The menu entry owning this path: longest matching prefix wins. */
export function findActiveNav(pathname: string): { group: NavGroup | null; item: NavItem } | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  let best: { group: NavGroup | null; item: NavItem; len: number } | null = null;
  for (const entry of ALL_ITEMS) {
    for (const prefix of [entry.item.href, ...(entry.item.also ?? [])]) {
      if (matches(path, prefix) && (!best || prefix.length > best.len)) best = { ...entry, len: prefix.length };
    }
  }
  return best && { group: best.group, item: best.item };
}

/** Whether an admin with this role sees the item. super_admin sees everything. */
export function canSee(item: NavItem, role: AdminRole | undefined): boolean {
  if (!role) return false;
  if (role === 'super_admin' || !item.roles) return true;
  return item.roles.includes(role);
}
