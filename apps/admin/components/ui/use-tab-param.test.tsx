import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useTabParam } from '@/lib/use-tab-param';

// The hook watches the pathname; the test drives it like Next would on a
// client navigation between two records of the same static-export page.
let pathname = '/wash/partners/abc/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const KEYS = ['overview', 'pay', 'referral', 'account'] as const;

function go(url: string) {
  window.history.replaceState(null, '', url);
  pathname = new URL(url, window.location.origin).pathname;
}

beforeEach(() => go('/wash/partners/abc/'));
afterEach(cleanup);

describe('useTabParam', () => {
  it('reads a valid tab from the URL', () => {
    go('/wash/partners/abc/?tab=pay');
    const { result } = renderHook(() => useTabParam(KEYS));
    expect(result.current[0]).toBe('pay');
  });

  it('falls back to the first key on an unknown tab', () => {
    go('/wash/partners/abc/?tab=nope');
    const { result } = renderHook(() => useTabParam(KEYS));
    expect(result.current[0]).toBe('overview');
  });

  it('setter changes the URL without adding a history entry', () => {
    const { result } = renderHook(() => useTabParam(KEYS));
    const before = window.history.length;
    act(() => result.current[1]('account'));
    expect(result.current[0]).toBe('account');
    expect(window.location.search).toBe('?tab=account');
    expect(window.history.length).toBe(before);
  });

  it('keeps other query params and the hash', () => {
    go('/wash/partners/abc/?from=list&tab=pay#top');
    const { result } = renderHook(() => useTabParam(KEYS));
    act(() => result.current[1]('account'));
    const sp = new URLSearchParams(window.location.search);
    expect(sp.get('from')).toBe('list');
    expect(sp.get('tab')).toBe('account');
    expect(window.location.hash).toBe('#top');
  });

  it('the first key drops the param', () => {
    go('/wash/partners/abc/?tab=pay&x=1');
    const { result } = renderHook(() => useTabParam(KEYS));
    act(() => result.current[1]('overview'));
    expect(result.current[0]).toBe('overview');
    expect(window.location.search).toBe('?x=1');
  });

  it('honours a custom param name', () => {
    go('/wash/partners/abc/?view=account');
    const { result } = renderHook(() => useTabParam(KEYS, 'view'));
    expect(result.current[0]).toBe('account');
  });

  it('re-reads the tab when the pathname changes', () => {
    go('/wash/partners/abc/?tab=pay');
    const { result, rerender } = renderHook(() => useTabParam(KEYS));
    expect(result.current[0]).toBe('pay');
    go('/wash/partners/xyz/');
    rerender();
    expect(result.current[0]).toBe('overview');
    go('/wash/partners/def/?tab=account');
    rerender();
    expect(result.current[0]).toBe('account');
  });

  it('re-reads the tab on popstate', () => {
    const { result } = renderHook(() => useTabParam(KEYS));
    expect(result.current[0]).toBe('overview');
    act(() => {
      window.history.replaceState(null, '', '/wash/partners/abc/?tab=pay');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toBe('pay');
  });

  it('falls back when the tab is not in the role-filtered keys, and opens once it is', () => {
    go('/wash/partners/abc/?tab=referral');
    const { result, rerender } = renderHook(({ keys }) => useTabParam(keys), {
      initialProps: { keys: ['overview', 'pay', 'account'] as readonly string[] },
    });
    expect(result.current[0]).toBe('overview');
    rerender({ keys: KEYS });
    expect(result.current[0]).toBe('referral');
  });

  it('is not ready on the first render, before the URL is read', () => {
    go('/wash/partners/abc/?tab=pay');
    const seen: Array<[string, boolean]> = [];
    const { result } = renderHook(() => {
      const r = useTabParam(KEYS);
      seen.push([r[0], r[2]]);
      return r;
    });
    expect(seen[0]).toEqual(['overview', false]);
    expect(result.current[0]).toBe('pay');
    expect(result.current[2]).toBe(true);
    // No render ever claimed the placeholder tab as ready.
    expect(seen.filter(([t, ready]) => ready && t !== 'pay')).toEqual([]);
  });

  it('is not ready again until the new pathname has been read', () => {
    go('/wash/partners/abc/?tab=pay');
    const seen: Array<[string, boolean]> = [];
    const { result, rerender } = renderHook(() => {
      const r = useTabParam(KEYS);
      seen.push([r[0], r[2]]);
      return r;
    });
    go('/wash/partners/xyz/?tab=account');
    seen.length = 0;
    rerender();
    expect(seen[0][1]).toBe(false);
    expect(result.current[0]).toBe('account');
    expect(result.current[2]).toBe(true);
  });

  it('stays ready after a tab switch', () => {
    const { result } = renderHook(() => useTabParam(KEYS));
    act(() => result.current[1]('pay'));
    expect(result.current[2]).toBe(true);
  });

  it('refuses an empty key list', () => {
    // React reports the render error to console.error and jsdom to stderr; keep the run quiet.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', swallow);
    try {
      expect(() => renderHook(() => useTabParam([] as readonly string[]))).toThrow(/at least one key/);
    } finally {
      window.removeEventListener('error', swallow);
      quiet.mockRestore();
    }
  });
});
