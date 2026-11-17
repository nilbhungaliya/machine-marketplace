'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const COLLAPSED_KEY = 'admin.sidebar.collapsed';
const FOLDED_KEY = 'admin.sidebar.folded';

// Stored values are checked, not trusted: valid JSON of the wrong shape falls back.
function readBool(key: string): boolean {
  try { return window.localStorage.getItem(key) === 'true'; } catch { return false; }
}
function readStrings(key: string): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function write(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: keep in memory */ }
}

interface SidebarState {
  /** Icon-only rail. */
  collapsed: boolean;
  toggleCollapsed: () => void;
  isGroupFolded: (id: string) => boolean;
  toggleGroup: (id: string) => void;
}

const Ctx = createContext<SidebarState | null>(null);

export function SidebarStateProvider({ children }: { children: ReactNode }) {
  // Lazy init: the provider only renders on the client (AuthProvider shows a
  // spinner until loaded), so stored values are read on the first render.
  const [userCollapsed, setUserCollapsed] = useState(() => readBool(COLLAPSED_KEY));
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches,
  );
  const [folded, setFolded] = useState<string[]>(() => readStrings(FOLDED_KEY));

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setUserCollapsed((c) => { write(COLLAPSED_KEY, !c); return !c; });
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setFolded((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      write(FOLDED_KEY, next);
      return next;
    });
  }, []);

  const isGroupFolded = useCallback((id: string) => folded.includes(id), [folded]);

  return (
    <Ctx.Provider value={{ collapsed: narrow || userCollapsed, toggleCollapsed, isGroupFolded, toggleGroup }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSidebarState(): SidebarState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSidebarState must be used within SidebarStateProvider');
  return ctx;
}
