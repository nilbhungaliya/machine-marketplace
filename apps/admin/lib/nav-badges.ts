'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchWaitingCount, REVIEW_LIST_CAP } from './verification-api';

/** Counts a menu item can show beside its label (`NavItem.badgeKey`). */
export type NavBadgeKey = 'verificationWaiting';

const FETCHERS: Record<NavBadgeKey, () => Promise<number>> = {
  verificationWaiting: fetchWaitingCount,
};

/** The most a badge can know: the review list stops at REVIEW_LIST_CAP rows. */
const CAPS: Partial<Record<NavBadgeKey, number>> = { verificationWaiting: REVIEW_LIST_CAP };

const REFRESH_EVENT = 'mpm:nav-badges';

/** Ask the sidebar to fetch its counts again, e.g. after a review is decided. */
export function refreshNavBadges(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFRESH_EVENT));
}

/** "200+" at the cap; nothing for zero. */
export function badgeText(key: NavBadgeKey, count: number | undefined): string | null {
  if (!count) return null;
  const cap = CAPS[key];
  return cap !== undefined && count >= cap ? `${cap}+` : String(count);
}

/**
 * The counts for the badges the admin can see, fetched on mount, whenever `refreshKey` changes (the page) and on
 * `refreshNavBadges()`. A failed fetch just shows no badge.
 */
export function useNavBadges(keys: readonly NavBadgeKey[], refreshKey: string): Partial<Record<NavBadgeKey, number>> {
  const [counts, setCounts] = useState<Partial<Record<NavBadgeKey, number>>>({});
  const sig = keys.join(',');

  const load = useCallback(() => {
    for (const key of sig ? (sig.split(',') as NavBadgeKey[]) : []) {
      FETCHERS[key]()
        .then((n) => setCounts((prev) => (prev[key] === n ? prev : { ...prev, [key]: n })))
        .catch(() => {});
    }
  }, [sig]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, load);
    return () => window.removeEventListener(REFRESH_EVENT, load);
  }, [load]);

  return counts;
}
