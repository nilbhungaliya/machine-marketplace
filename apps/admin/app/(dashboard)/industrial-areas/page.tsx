'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { IndustrialArea } from '@mpm/shared-types';
import { AreaFormDialog, AreasList } from '@/components/industrial-areas/areas-list';
import { OtherValues } from '@/components/industrial-areas/other-values';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StaleWarning } from '@/components/ui/stale-warning';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { cityKey, fetchAreas, fetchOtherValues, type OtherValue } from '@/lib/industrial-areas-api';
import { useTabParam } from '@/lib/use-tab-param';
import { useUrlState } from '@/lib/use-url-state';
import { inputCls } from '@/components/ui/field-classes';
import { cn } from '@/lib/utils';

const TAB_KEYS = ['areas', 'other'] as const;
type TabKey = (typeof TAB_KEYS)[number];

interface CityList {
  key: string;
  city: string;
  state: string;
  areas: IndustrialArea[];
}

/** The areas by city (the city ignoring case, the state exactly, as the API groups them), in the API's order. */
function byCity(areas: IndustrialArea[]): CityList[] {
  const lists = new Map<string, CityList>();
  for (const area of areas) {
    const key = cityKey(area.city.toLowerCase(), area.state);
    const list = lists.get(key) ?? { key, city: area.city, state: area.state, areas: [] };
    list.areas.push(area);
    lists.set(key, list);
  }
  return Array.from(lists.values());
}

/** F1 spec §4.3, §8.3: the industrial areas businesses pick from, per city, and the "Other" texts they typed. */
export default function IndustrialAreasPage() {
  const [tab, setTab, tabReady] = useTabParam(TAB_KEYS);
  const [{ city: cityParam }, setUrl, urlReady] = useUrlState({ city: '' });
  const [areas, setAreas] = useState<IndustrialArea[] | null>(null);
  const [others, setOthers] = useState<OtherValue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, o] = await Promise.all([fetchAreas(), fetchOtherValues()]);
      setAreas(a);
      setOthers(o);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the industrial areas');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cities = useMemo(() => (areas ? byCity(areas) : []), [areas]);
  const selected = cities.find((c) => c.key === cityParam) ?? cities[0] ?? null;
  const ready = tabReady && urlReady;

  const tabs: Array<{ value: TabKey; label: string; count?: number }> = [
    { value: 'areas', label: 'Areas', count: areas?.length },
    { value: 'other', label: 'Typed as Other', count: others?.length },
  ];

  return (
    <div>
      <PageHeader
        title="Industrial areas"
        description="The areas businesses pick from for their location, per city, and the ones they typed in themselves."
        actions={tab === 'areas' && areas && <Button onClick={() => setAdding(true)}><Plus size={15} aria-hidden /> Add area</Button>}
      />
      <Tabs items={tabs} value={tab} onChange={setTab} />

      {error && !areas ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !areas || !others || !ready ? (
        <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={6} cols={3} /></div>
      ) : (
        <>
          {error && <StaleWarning thing="list" onRetry={() => void load()} />}
          {tab === 'other' ? (
            <>
              <p className="mb-3 text-sm text-gray-500">
                What businesses typed under Other, grouped by their pincode&apos;s district. Add to list creates the area there
                and links every business that typed it.
              </p>
              <OtherValues rows={others} onAdopted={() => void load()} />
            </>
          ) : !selected ? (
            <div className="rounded-[20px] border border-gray-200 bg-white">
              <EmptyState
                title="No industrial areas yet"
                description="Add the first area of a city. Businesses in that city's pincodes then pick from the list."
                action={<Button onClick={() => setAdding(true)}><Plus size={15} aria-hidden /> Add area</Button>}
              />
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <label htmlFor="area-city-picker" className="text-sm font-semibold text-gray-700">City</label>
                <select
                  id="area-city-picker"
                  className={cn(inputCls, 'w-auto min-w-[14rem]')}
                  value={selected.key}
                  onChange={(e) => setUrl({ city: e.target.value })}
                >
                  {cities.map((c) => (
                    <option key={c.key} value={c.key}>{c.city}, {c.state} ({c.areas.length})</option>
                  ))}
                </select>
                <span className="text-[13px] text-gray-500">The app lists them in this order; turned-off areas stay with the businesses that picked them.</span>
              </div>
              <AreasList key={selected.key} areas={selected.areas} city={selected.city} state={selected.state} onChanged={load} />
            </>
          )}
        </>
      )}

      {adding && (
        <AreaFormDialog
          start={selected ? { city: selected.city, state: selected.state } : undefined}
          onClose={() => setAdding(false)}
          onSaved={async (area) => {
            await load();
            setUrl({ city: cityKey(area.city.toLowerCase(), area.state) });
          }}
        />
      )}
    </div>
  );
}
