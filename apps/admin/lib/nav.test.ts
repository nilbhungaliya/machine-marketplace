import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, canSee, findActiveNav } from './nav';

describe('findActiveNav', () => {
  it('maps the root to the dashboard', () => {
    expect(findActiveNav('/')?.item.label).toBe('Dashboard');
  });

  it('matches nested routes and trailing slashes to their menu item', () => {
    expect(findActiveNav('/listings/abc-123/')?.item.href).toBe('/listings');
    expect(findActiveNav('/moderation')?.group?.id).toBe('queues');
  });

  it('every menu entry has a page', () => {
    for (const href of NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))) {
      expect(existsSync(join(__dirname, '..', 'app', '(dashboard)', href, 'page.tsx')), href).toBe(true);
    }
  });

  it('returns null for a page outside the menu', () => {
    expect(findActiveNav('/login')).toBeNull();
  });

  it('every href is unique', () => {
    const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('canSee', () => {
  const settings = NAV_GROUPS.find((g) => g.id === 'system')!.items[0];
  const moderation = NAV_GROUPS.find((g) => g.id === 'queues')!.items[0];

  it('super_admin sees everything', () => {
    expect(canSee(settings, 'super_admin')).toBe(true);
  });

  it('other roles see only their items', () => {
    expect(canSee(moderation, 'moderator')).toBe(true);
    expect(canSee(moderation, 'operations')).toBe(false);
    expect(canSee(settings, 'moderator')).toBe(false);
  });

  it('nobody sees anything signed out', () => {
    expect(canSee(moderation, undefined)).toBe(false);
  });
});

describe('F1 + A2 menu entries', () => {
  const item = (href: string) => NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href)!;

  it('moderators see Users & businesses', () => {
    expect(canSee(item('/businesses'), 'moderator')).toBe(true);
    expect(canSee(item('/businesses'), 'category_manager')).toBe(false);
  });

  it('Industrial areas sits with Units, conditions & sides, for category managers', () => {
    const group = NAV_GROUPS.find((g) => g.items.some((i) => i.href === '/master-data'))!;
    expect(group.items.map((i) => i.href)).toContain('/industrial-areas');
    expect(canSee(item('/industrial-areas'), 'category_manager')).toBe(true);
    expect(canSee(item('/industrial-areas'), 'support')).toBe(false);
  });

  it('Business verification shows the Waiting count', () => {
    expect(item('/verification').badgeKey).toBe('verificationWaiting');
  });
});

describe('F4 + F5 search menu entries', () => {
  const item = (href: string) => NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href);

  it('Search synonyms and Search insights sit with the catalogue, for category managers and super admins only', () => {
    const group = NAV_GROUPS.find((g) => g.id === 'configuration')!;
    expect(group.items.map((i) => i.href)).toEqual(expect.arrayContaining(['/search-synonyms', '/search-insights']));
    for (const href of ['/search-synonyms', '/search-insights']) {
      const entry = item(href)!;
      expect(entry.roles).toEqual(['category_manager']);
      expect(canSee(entry, 'category_manager')).toBe(true);
      expect(canSee(entry, 'super_admin')).toBe(true);
      for (const role of ['moderator', 'verification_officer', 'operations', 'support'] as const) {
        expect(canSee(entry, role), `${href} ${role}`).toBe(false);
      }
    }
  });
});

describe('F6 + F7 menu entries (spec §16.1, the API roles)', () => {
  const item = (href: string) => NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href);
  const OTHERS = ['moderator', 'verification_officer', 'category_manager', 'operations', 'support'] as const;

  it('Disputes sits in Queues with the open count, for support and super admins only', () => {
    const queues = NAV_GROUPS.find((g) => g.id === 'queues')!;
    expect(queues.items.map((i) => i.href)).toContain('/disputes');
    const disputes = item('/disputes')!;
    expect(disputes.badgeKey).toBe('disputesOpen');
    expect(canSee(disputes, 'super_admin')).toBe(true);
    for (const role of OTHERS) expect(canSee(disputes, role), role).toBe(role === 'support');
  });

  it('Enquiries & offers and Deals: support and operations', () => {
    for (const href of ['/enquiries', '/deals']) {
      expect(canSee(item(href)!, 'super_admin')).toBe(true);
      for (const role of OTHERS) expect(canSee(item(href)!, role), `${href} ${role}`).toBe(role === 'support' || role === 'operations');
    }
  });

  it('Conversations and Reports & flags: moderators and support', () => {
    for (const href of ['/chats', '/reports']) {
      for (const role of OTHERS) expect(canSee(item(href)!, role), `${href} ${role}`).toBe(role === 'moderator' || role === 'support');
    }
  });

  it('a deal or dispute record lights its own menu entry', () => {
    expect(findActiveNav('/disputes/abc/')?.item.href).toBe('/disputes');
    expect(findActiveNav('/deals/abc/')?.item.href).toBe('/deals');
    expect(findActiveNav('/enquiries/abc/')?.item.href).toBe('/enquiries');
  });

  it('M14 Rental bookings: operations and support (spec §15), a booking record lights it', () => {
    expect(canSee(item('/rentals')!, 'super_admin')).toBe(true);
    for (const role of OTHERS) expect(canSee(item('/rentals')!, role), role).toBe(role === 'operations' || role === 'support');
    expect(findActiveNav('/rentals/abc/')?.item.href).toBe('/rentals');
  });
});

describe('Admin close-out menu (spec §13, R5, R7)', () => {
  const all = () => NAV_GROUPS.flatMap((g) => g.items);
  const item = (href: string) => all().find((i) => i.href === href);

  it('Activity & KPIs is gone: the dashboard is AD1 and /analytics redirects', () => {
    expect(item('/analytics')).toBeUndefined();
    expect(findActiveNav('/analytics')).toBeNull();
  });

  it('System holds Settings, Admin users and Audit log, for super admins only', () => {
    const system = NAV_GROUPS.find((g) => g.id === 'system')!;
    expect(system.items.map((i) => [i.href, i.label])).toEqual([
      ['/settings', 'Settings'], ['/admin-users', 'Admin users'], ['/audit-log', 'Audit log'],
    ]);
    const adminUsers = item('/admin-users')!;
    expect(canSee(adminUsers, 'super_admin')).toBe(true);
    expect(canSee(adminUsers, 'support')).toBe(false);
    for (const entry of system.items) {
      for (const role of ['moderator', 'verification_officer', 'category_manager', 'operations', 'support'] as const) {
        expect(canSee(entry, role), `${entry.href} ${role}`).toBe(false);
      }
    }
  });

  it('Reports & flags shows the open reports + signals count', () => {
    expect(item('/reports')!.badgeKey).toBe('reportsOpen');
  });
});
