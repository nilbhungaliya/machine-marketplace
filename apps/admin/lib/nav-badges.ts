'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchOpenDisputeCount } from './disputes-api';
import { fetchModerationWaiting } from './listings-api';
import { getAdminSocket } from './socket';
import { fetchWaitingCount } from './verification-api';

/** Counts a menu item can show beside its label (`NavItem.badgeKey`). */
export type NavBadgeKey = 'verificationWaiting' | 'moderationWaiting' | 'disputesOpen';

const FETCHERS: Record<NavBadgeKey, () => Promise<number>> = {
  verificationWaiting: fetchWaitingCount,
  /** Listings waiting for review plus listings with open reports (F2 spec §11.1). */
  moderationWaiting: fetchModerationWaiting,
  /** Open disputes (F6 + F7 §16.1), support's queue. */
  disputesOpen: fetchOpenDisputeCount,
};

/**
 * Admin socket events (ids only) that change a count: the badge is fetched again when one arrives. `dispute:new` goes
 * to `adminRoleRoom('support')` (F6 + F7 §16.2); the poll covers everyone else.
 */
const SOCKET_EVENTS: Partial<Record<NavBadgeKey, string>> = {
  disputesOpen: 'dispute:new',
};

/** How often the counts are fetched again while the tab is visible. */
export const NAV_BADGE_POLL_MS = 60_000;

const REFRESH_EVENT = 'mpm:nav-badges';

/** Ask the sidebar to fetch its counts again, e.g. after a review or a listing is decided. */
export function refreshNavBadges(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFRESH_EVENT));
}

/** The count; nothing for zero or an unknown count. */
export function badgeText(_key: NavBadgeKey, count: number | undefined): string | null {
  return count ? String(count) : null;
}

/**
 * The counts for the badges the admin can see: fetched on mount, on `refreshNavBadges()` (after a decision), when the
 * window regains focus or the tab becomes visible, and every NAV_BADGE_POLL_MS while it is visible. Not on every page
 * change: each fetch is one small count request. A failed fetch just shows no badge.
 */
export function useNavBadges(keys: readonly NavBadgeKey[]): Partial<Record<NavBadgeKey, number>> {
  const [counts, setCounts] = useState<Partial<Record<NavBadgeKey, number>>>({});
  const sig = keys.join(',');

  const load = useCallback(() => {
    for (const key of sig ? (sig.split(',') as NavBadgeKey[]) : []) {
      FETCHERS[key]()
        .then((n) => setCounts((prev) => (prev[key] === n ? prev : { ...prev, [key]: n })))
        .catch(() => {});
    }
  }, [sig]);

  // Live nudges for the counts that have a socket event; one fetch of that count per event.
  useEffect(() => {
    const keys = (sig ? (sig.split(',') as NavBadgeKey[]) : []).filter((k) => SOCKET_EVENTS[k]);
    if (keys.length === 0) return;
    const socket = getAdminSocket();
    const handlers = keys.map((key) => {
      const handler = () => {
        FETCHERS[key]()
          .then((n) => setCounts((prev) => (prev[key] === n ? prev : { ...prev, [key]: n })))
          .catch(() => {});
      };
      socket.on(SOCKET_EVENTS[key]!, handler);
      return [SOCKET_EVENTS[key]!, handler] as const;
    });
    return () => { for (const [event, handler] of handlers) socket.off(event, handler); };
  }, [sig]);

  useEffect(() => {
    load();
    const visible = () => document.visibilityState !== 'hidden';
    const onVisible = () => { if (visible()) load(); };
    const timer = window.setInterval(onVisible, NAV_BADGE_POLL_MS);
    window.addEventListener(REFRESH_EVENT, load);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(REFRESH_EVENT, load);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return counts;
}
