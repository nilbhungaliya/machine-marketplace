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
