'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// Each PageHeader owns one entry, keyed by its own id. An unmounting header can
// only remove its own entry, so it can never clear the trail a newer page set.
type Entry = { id: number; trail: string[] };
type Ctx = { entries: Entry[]; set: (id: number, trail: string[]) => void; remove: (id: number) => void };
const PageTrailContext = createContext<Ctx | null>(null);
let nextId = 1;

export function PageTrailProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const set = useCallback((id: number, trail: string[]) => {
    // An update moves the entry to the end, so "last" always means most recently set.
    setEntries((es) => [...es.filter((e) => e.id !== id), { id, trail }]);
  }, []);
  const remove = useCallback((id: number) => setEntries((es) => es.filter((e) => e.id !== id)), []);
  const value = useMemo(() => ({ entries, set, remove }), [entries, set, remove]);
  return <PageTrailContext.Provider value={value}>{children}</PageTrailContext.Provider>;
}

/** Read by the top bar: the most recently set non-empty trail. */
export function usePageTrail(): string[] {
  const entries = useContext(PageTrailContext)?.entries ?? [];
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].trail.length) return entries[i].trail;
  return [];
}

/** Called by PageHeader. */
export function useSetPageTrail(trail?: string[]) {
  const ctx = useContext(PageTrailContext);
  const id = useRef(0);
  if (id.current === 0) id.current = nextId++;
  const key = (trail ?? []).join('\u0000');
  useEffect(() => {
    ctx?.set(id.current, trail ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is the stable form of trail
  }, [key, ctx?.set]);
  useEffect(() => {
    const own = id.current;
    return () => ctx?.remove(own);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remove is stable; runs on unmount only
  }, []);
}
