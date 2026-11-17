'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The open tab, kept in `?tab=` so a link or a reload lands on it.
 *
 * Read off window, not useSearchParams (the admin is a static export, which
 * would need a Suspense boundary): after mount, again whenever the pathname
 * changes — moving from one record to another keeps this page mounted — and on
 * popstate. The URL is replaced, never pushed: a tab switch must not become a
 * Back step, and history.state is kept because the unsaved-changes guard
 * stores its mark there.
 *
 * What the URL asked for is checked against `keys` on every render, so a tab
 * outside the (role-filtered) keys shows `keys[0]`, and opens once its key
 * arrives.
 *
 * `ready` is false until the URL has been read for the current pathname. Until
 * then `tab` is only the `keys[0]` placeholder: mount panels once `ready`, or a
 * deep link to another tab briefly mounts the first one and fires its fetches.
 */
export function useTabParam<T extends string>(
  keys: readonly T[],
  param = 'tab',
): [T, (next: T) => void, boolean] {
  if (keys.length === 0 && process.env.NODE_ENV !== 'production') {
    throw new Error('useTabParam needs at least one key');
  }
  const pathname = usePathname();
  // The pathname the read was made for, so a move to another record is not ready until re-read.
  const [read, setRead] = useState<{ path: string | null; value: string | null }>({ path: null, value: null });
  const requested = read.value;
  const ready = read.path === pathname;

  useEffect(() => {
    const readUrl = () => setRead({ path: pathname, value: new URLSearchParams(window.location.search).get(param) });
    readUrl();
    window.addEventListener('popstate', readUrl);
    return () => window.removeEventListener('popstate', readUrl);
  }, [param, pathname]);

  const first = keys[0];
  const tab = requested !== null && (keys as readonly string[]).includes(requested) ? (requested as T) : first;

  const setTab = useCallback((next: T) => {
    setRead({ path: pathname, value: next });
    const url = new URL(window.location.href);
    if (next === first) url.searchParams.delete(param);
    else url.searchParams.set(param, next);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [first, param, pathname]);

  return [tab, setTab, ready];
}
