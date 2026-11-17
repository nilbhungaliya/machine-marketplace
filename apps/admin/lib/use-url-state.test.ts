// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useUrlState } from './use-url-state';

let pathname = '/listings/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

function go(url: string) {
  window.history.replaceState(null, '', url);
  pathname = new URL(url, window.location.origin).pathname;
}
const params = () => Object.fromEntries(new URLSearchParams(window.location.search));

const DEFAULTS = { q: '', view: 'all', page: '1' };

beforeEach(() => go('/listings/'));
afterEach(cleanup);

describe('useUrlState', () => {
  it('gives the defaults when the URL has none of the keys', () => {
    const { result } = renderHook(() => useUrlState(DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);
    expect(result.current[2]).toBe(true);
  });

  it('reads the keys on mount', () => {
    go('/listings/?q=ravi&view=available&page=3');
    const { result } = renderHook(() => useUrlState(DEFAULTS));
    expect(result.current[0]).toEqual({ q: 'ravi', view: 'available', page: '3' });
  });

  it('writes with replaceState, keeping other params and the hash', () => {
    go('/listings/?from=home#list');
    const { result } = renderHook(() => useUrlState(DEFAULTS));
    const before = window.history.length;
    act(() => result.current[1]({ q: 'asha', page: '2' }));
    expect(result.current[0]).toEqual({ q: 'asha', view: 'all', page: '2' });
    expect(params()).toEqual({ from: 'home', q: 'asha', page: '2' });
    expect(window.location.hash).toBe('#list');
    expect(window.history.length).toBe(before);
  });

  it('keeps history.state (the unsaved-changes guard stores its mark there)', () => {
    window.history.replaceState({ mark: 1 }, '', '/listings/');
    const { result } = renderHook(() => useUrlState(DEFAULTS));
    act(() => result.current[1]({ q: 'x' }));
    expect(window.history.state).toEqual({ mark: 1 });
  });

  it('drops a param set back to its default', () => {
    go('/listings/?q=ravi&page=4&x=1');
    const { result } = renderHook(() => useUrlState(DEFAULTS));
    act(() => result.current[1]({ q: '', page: '1' }));
    expect(params()).toEqual({ x: '1' });
    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it('normalises invalid values to the default on read', () => {
    go('/listings/?view=bogus&page=-2&q=ok');
    const { result } = renderHook(() =>
      useUrlState(DEFAULTS, { validate: { view: ['all', 'available'], page: (v) => /^[1-9]\d*$/.test(v) } }),
    );
    expect(result.current[0]).toEqual({ q: 'ok', view: 'all', page: '1' });
  });

  it('an invalid value written through the setter drops the param', () => {
    go('/listings/?view=available');
    const { result } = renderHook(() => useUrlState(DEFAULTS, { validate: { view: ['all', 'available'] } }));
    act(() => result.current[1]({ view: 'bogus' }));
    expect(result.current[0].view).toBe('all');
    expect(params()).toEqual({});
  });

  it('re-reads on popstate', () => {
    const { result } = renderHook(() => useUrlState(DEFAULTS));
    act(() => {
      window.history.replaceState(null, '', '/listings/?q=back');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0].q).toBe('back');
  });

  it('re-reads when the pathname changes', () => {
    go('/listings/?q=one');
    const { result, rerender } = renderHook(() => useUrlState(DEFAULTS));
    expect(result.current[0].q).toBe('one');
    go('/deals/?q=two');
    rerender();
    expect(result.current[0].q).toBe('two');
  });

  it('two consumers with different keys do not overwrite each other', () => {
    go('/listings/?q=keep&status=active');
    const { result } = renderHook(() => ({
      list: useUrlState({ q: '', page: '1' }),
      side: useUrlState({ status: '', sort: '' }),
    }));
    act(() => result.current.list[1]({ page: '2' }));
    act(() => result.current.side[1]({ sort: 'name:asc' }));
    act(() => result.current.list[1]({ q: 'new' }));
    expect(params()).toEqual({ q: 'new', page: '2', status: 'active', sort: 'name:asc' });
    expect(result.current.list[0]).toEqual({ q: 'new', page: '2' });
    expect(result.current.side[0]).toEqual({ status: 'active', sort: 'name:asc' });
  });

  it('two consumers writing in the same tick both survive', () => {
    go('/listings/?keep=1');
    const { result } = renderHook(() => ({
      list: useUrlState({ q: '', page: '1' }),
      side: useUrlState({ status: '', sort: '' }),
    }));
    act(() => {
      result.current.list[1]({ q: 'same', page: '3' });
      result.current.side[1]({ status: 'active' });
    });
    expect(params()).toEqual({ keep: '1', q: 'same', page: '3', status: 'active' });
    expect(result.current.list[0]).toEqual({ q: 'same', page: '3' });
    expect(result.current.side[0]).toEqual({ status: 'active', sort: '' });
  });

  it('the state object is stable while its values do not change', () => {
    go('/listings/?q=a');
    const { result, rerender } = renderHook(() => useUrlState({ q: '', page: '1' }));
    const first = result.current[0];
    rerender();
    expect(result.current[0]).toBe(first);
    act(() => result.current[1]({ q: 'b' }));
    expect(result.current[0]).not.toBe(first);
  });

  it('the setter is stable across renders with an inline defaults object', () => {
    const { result, rerender } = renderHook(() => useUrlState({ q: '' }));
    const first = result.current[1];
    rerender();
    expect(result.current[1]).toBe(first);
  });
});
