'use client';

import { useEffect, useRef } from 'react';
import { getAdminSocket } from '@/lib/socket';

/**
 * Refetch when the server says one of `sections` changed. Both events are
 * needed: `admin:pending_changed` is the plain nudge, `admin:notification` an
 * escalation, and a booking moves through either. A sectionless event matches.
 *
 * `refetch` sits in a ref so a fetcher rebuilt on every filter change does not
 * re-subscribe the socket each time.
 */
export function useLiveRefresh(sections: readonly string[], refetch: () => void) {
  const latest = useRef(refetch);
  useEffect(() => { latest.current = refetch; }, [refetch]);

  // Joined, because a fresh array literal on every render would re-subscribe.
  const key = sections.join(',');

  useEffect(() => {
    const allowed = new Set(key.split(','));
    const socket = getAdminSocket();
    const onEvent = (payload: { section?: string | null } = {}) => {
      const section = payload?.section;
      if (!section || allowed.has(section)) latest.current();
    };
    socket.on('admin:notification', onEvent);
    socket.on('admin:pending_changed', onEvent);
    return () => {
      socket.off('admin:notification', onEvent);
      socket.off('admin:pending_changed', onEvent);
    };
  }, [key]);
}

