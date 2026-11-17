'use client';
import { useEffect, useState } from 'react';

export interface BackTarget { href: string; label: string }

/**
 * Honours a `?from=` set by whoever linked here, so a page reached from
 * somewhere other than its own list sends the reader back where they were.
 *
 * Read off `window` rather than useSearchParams, which would oblige every
 * caller into a Suspense boundary to keep building.
 */
export function useBackTarget(fallback: BackTarget): BackTarget {
  const [target, setTarget] = useState(fallback);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const from = q.get('from');
    // Internal paths only — '//host' is a URL, not a path.
    if (!from || !from.startsWith('/') || from.startsWith('//')) return;
    setTarget({ href: from, label: q.get('fromLabel')?.slice(0, 60) || 'Back' });
  }, []);

  return target;
}

/** The query string that makes the linked page come back here. */
export function backLinkQuery(href: string, label: string): string {
  return `from=${encodeURIComponent(href)}&fromLabel=${encodeURIComponent(label)}`;
}
