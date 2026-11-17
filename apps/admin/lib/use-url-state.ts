'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/** An allowed list, or a predicate. A value that fails reads as the default. */
export type UrlValueCheck = readonly string[] | ((value: string) => boolean);

export interface UrlStateOptions<K extends string> {
  validate?: Partial<Record<K, UrlValueCheck>>;
}

function isValid(check: UrlValueCheck | undefined, value: string): boolean {
  if (!check) return true;
  return typeof check === 'function' ? check(value) : check.includes(value);
}

/** 1, 2, 3… — the usual check for a `page` param. */
export const positiveInt = (value: string) => /^[1-9]\d*$/.test(value);

/**
 * A set of query params as state, for list search/filter/sort/page.
 *
 * Same approach as useTabParam: read off window after mount, again on a
 * pathname change and on popstate; written with replaceState (no Back step,
 * history.state kept), other params and the hash untouched. A value equal to
 * its default — or failing its check — is dropped from the URL and reads as the
 * default. One owner per param: two hooks must not share a key.
 *
 * `ready` is false until the URL has been read for the current pathname; wait
 * for it before fetching with these values.
 */
export function useUrlState<K extends string>(
  defaults: Record<K, string>,
  options?: UrlStateOptions<K>,
): [Record<K, string>, (patch: Partial<Record<K, string>>) => void, boolean] {
  const pathname = usePathname();
  const keys = Object.keys(defaults) as K[];
  const keySig = keys.join('\u0000');

  // Latest defaults and checks for the setter, so an inline object doesn't make it unstable.
  const cfg = useRef({ defaults, validate: options?.validate });
  cfg.current = { defaults, validate: options?.validate };

  const [read, setRead] = useState<{ path: string | null; raw: Partial<Record<K, string>> }>({ path: null, raw: {} });

  useEffect(() => {
    const readUrl = () => {
      const sp = new URLSearchParams(window.location.search);
      const raw: Partial<Record<K, string>> = {};
      for (const k of keySig.split('\u0000') as K[]) {
        const v = sp.get(k);
        if (v !== null) raw[k] = v;
      }
      setRead({ path: pathname, raw });
    };
    readUrl();
    window.addEventListener('popstate', readUrl);
    return () => window.removeEventListener('popstate', readUrl);
  }, [keySig, pathname]);

  // Memoised on the resolved values, so callers can put `state` in a dependency array.
  const values = keys.map((k) => {
    const v = read.raw[k];
    return v !== undefined && isValid(options?.validate?.[k], v) ? v : defaults[k];
  });
  const valueSig = JSON.stringify(values);
  const state = useMemo(() => {
    const out = {} as Record<K, string>;
    const vals = JSON.parse(valueSig) as string[];
    keySig.split('\u0000').forEach((k, i) => { out[k as K] = vals[i]; });
    return out;
  }, [keySig, valueSig]);

  const setState = useCallback(
    (patch: Partial<Record<K, string>>) => {
      const { defaults: d, validate } = cfg.current;
      const url = new URL(window.location.href);
      const clean: Partial<Record<K, string>> = {};
      for (const k of Object.keys(patch) as K[]) {
        const v = patch[k];
        if (v === undefined || !(k in d)) continue;
        if (v === d[k] || !isValid(validate?.[k], v)) url.searchParams.delete(k);
        else {
          url.searchParams.set(k, v);
          clean[k] = v;
        }
      }
      setRead((prev) => {
        const raw = { ...prev.raw };
        for (const k of Object.keys(patch) as K[]) {
          if (patch[k] === undefined || !(k in d)) continue;
          if (k in clean) raw[k] = clean[k];
          else delete raw[k];
        }
        return { path: pathname, raw };
      });
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    },
    [pathname],
  );

  return [state, setState, read.path === pathname];
}
