'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Tabs } from './tabs';
import { useTabParam } from '@/lib/use-tab-param';

/**
 * A detail page's tabs, kept in `?tab=`. A panel mounts the first time its
 * tab opens and then stays mounted, hidden, so an unsaved inline edit survives
 * a tab switch and its data is not refetched on every visit. Nothing mounts
 * until the URL is read, so a deep link never fires the first tab's fetches.
 *
 * `items` may be filtered by role; the first item is the fallback tab. Key the
 * component by record id so moving to another record starts every tab fresh.
 */
export function RecordTabs<T extends string>({ items, panels }: {
  items: Array<{ value: T; label: string; count?: number }>;
  panels: Record<T, () => ReactNode>;
}) {
  const keys = items.map((t) => t.value);
  const [tab, setTab, ready] = useTabParam<T>(keys);
  const [visited, setVisited] = useState<Set<T>>(() => new Set());

  useEffect(() => {
    if (!ready) return;
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab, ready]);

  return (
    <>
      <Tabs items={items} value={tab} onChange={setTab} />
      {ready && keys.filter((k) => visited.has(k) || k === tab).map((k) => (
        <div key={k} role="tabpanel" hidden={k !== tab}>
          {panels[k]()}
        </div>
      ))}
    </>
  );
}
